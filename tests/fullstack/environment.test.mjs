// MAZ-62 full-stack environment suite: real .NET API processes, pinned PostgreSQL
// containers, the legacy Node/SQLite reference and the local OIDC provider. Opt-in
// (`npm run test:fullstack`): needs Docker or Podman, the .NET SDK and the search model.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { request as httpsRequest } from "node:https";
import {
  buildApi, collectArtifacts, containerCli, control, down, downAll, label, root, statePath, up,
} from "../../scripts/test-env/environment.mjs";
import { client, scenario, seed } from "../../scripts/test-env/seed.mjs";
import { compareLegacy, writeParityReport } from "../../scripts/test-env/compare.mjs";
import { clientId, startOidcProvider } from "../../scripts/test-env/oidc-provider.mjs";

const started = [];
const start = async (options = {}) => {
  const state = await up({ build: false, ...options });
  started.push(state.runId);
  return state;
};
const containers = (runId) => spawnSync(containerCli(), ["ps", "--all", "--quiet", "--filter", `label=${label}=${runId}`], { encoding: "utf8" })
  .stdout.split("\n").filter(Boolean);

before(() => buildApi(), { timeout: 600_000 });
after(async () => {
  for (const runId of started) await down(runId);
});

test("a seeded environment answers the published search expectations", { timeout: 600_000 }, async () => {
  const state = await start();
  const definition = scenario("searchable-household");
  const context = await seed(definition, {
    apiUrl: state.apiUrl, runTag: state.runId, setClock: (now) => control(state, "PUT", "clock", { now }),
  });
  const request = client(state.apiUrl);
  const key = (value) => value.replace(/^shared:\$expense:(.+)$/, (_, ref) => `shared:${context.expenseIds[ref]}`);
  for (const item of definition.searchExpectations) {
    const { body } = await request("POST", "/api/v1/search/transactions", { token: context.users[item.as].token, body: item.request });
    const keys = body.items.map((result) => result.key);
    const expected = item.keys.map(key);
    assert.deepEqual(keys.slice(0, expected.length), expected, item.why);
    assert.deepEqual(body.items.slice(0, expected.length).map((result) => result.match), item.matches, item.why);
    if (item.meaningAllowedAfter) assert.ok(body.items.slice(expected.length).every((result) => result.match === "meaning"), item.why);
    else assert.equal(keys.length, expected.length, item.why);
    for (const excluded of item.excludes) assert.ok(!keys.includes(key(excluded)), `${item.why}: ${excluded}`);
  }
  const artifacts = collectArtifacts(state);
  assert.ok(existsSync(`${artifacts}/api.log`));
  assert.ok(existsSync(`${artifacts}/postgres.log`));
  assert.doesNotMatch(JSON.stringify(spawnSync("cat", [`${artifacts}/environment.json`], { encoding: "utf8" }).stdout), new RegExp(state.controlToken));
});

test("concurrent environments are isolated and resets stay inside their run", { timeout: 600_000 }, async () => {
  const [first, second] = await Promise.all([start(), start()]);
  assert.notEqual(first.database, second.database);
  assert.notEqual(first.databasePort, second.databasePort);
  assert.notEqual(first.apiPort, second.apiPort);
  const user = await control(first, "POST", "users", { label: "isolated" });
  const login = (state) => fetch(`${state.apiUrl}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: user.email, password: user.password }),
  });
  assert.equal((await login(second)).status, 401, "accounts never leak between runs");
  await control(second, "POST", "reset");
  assert.equal((await login(first)).status, 200, "resetting one run leaves the other untouched");
  // One run's token cannot drive another run's controls.
  const foreign = await fetch(`${second.apiUrl}/api/test/reset`, { method: "POST", headers: { "X-Penny-Test-Token": first.controlToken } });
  assert.equal(foreign.status, 403);
});

test("a failed start removes everything it created", { timeout: 300_000 }, async () => {
  const runId = `fail${Date.now().toString(36).slice(-6)}`;
  const began = Date.now();
  await assert.rejects(up({ build: false, runId, origins: ["not an origin"] }), /exited during startup/);
  assert.ok(Date.now() - began < 60_000, "a crashed API is detected without waiting for the readiness timeout");
  assert.deepEqual(containers(runId), []);
  assert.equal(existsSync(statePath(runId)), false);
});

test("down --all sweeps runs whose runner crashed", { timeout: 300_000 }, async () => {
  // A runner that died without tearing down leaves its state, container and API.
  const state = await up({ build: false });
  // A container whose state directory is gone too (for example a cleaned workspace).
  const orphan = `orphan${Date.now().toString(36).slice(-6)}`;
  spawnSync(containerCli(), ["run", "--detach", "--label", `${label}=${orphan}`, state.image, "sleep", "300"]);
  assert.equal(containers(orphan).length, 1);
  const removed = await downAll();
  assert.ok(removed.includes(state.runId) && removed.includes(orphan));
  assert.deepEqual(containers(state.runId), []);
  assert.deepEqual(containers(orphan), []);
  assert.equal(existsSync(statePath(state.runId)), false);
  assert.throws(() => process.kill(state.apiPid, 0), "the API process is stopped");
});

test("legacy Node/SQLite and .NET/PostgreSQL agree on the differential journey", { timeout: 600_000 }, async () => {
  const state = await start({ worker: false });
  const report = await compareLegacy(state);
  // Written before asserting so a failure leaves the readable diff (CI job summary
  // and the fullstack-artifacts upload).
  writeParityReport(report, join(root, "test-results/fullstack/parity"));
  assert.deepEqual(report.differences, []);
  assert.equal(report.summary.matching, report.summary.probes);
});

function getRedirect(url, ca) {
  return new Promise((resolve, reject) => {
    httpsRequest(url, { ca }, (response) => {
      response.resume();
      resolve({ status: response.statusCode, location: response.headers.location });
    }).on("error", reject).end();
  });
}

test("OIDC sign-in completes against the local provider", { timeout: 600_000 }, async () => {
  const provider = await startOidcProvider();
  try {
    const state = await start({ oidc: provider.settings });
    provider.attach(state);
    const request = client(state.apiUrl);
    assert.deepEqual((await request("GET", "/api/auth/oidc")).body.enabled, true);
    const redirectUri = "http://127.0.0.1:4173/auth/callback";
    const { body: challenge } = await request("POST", "/api/auth/oidc/start", { body: { redirectUri } });
    const authorize = new URL(challenge.authorizationUrl);
    assert.equal(authorize.origin, provider.issuer);
    assert.equal(authorize.searchParams.get("client_id"), clientId);
    authorize.searchParams.set("login_hint", "sso-person");
    const ca = (await import("node:fs")).readFileSync(provider.certificatePath, "utf8");
    const redirect = await getRedirect(authorize, ca);
    assert.equal(redirect.status, 302);
    assert.ok(redirect.location.startsWith(redirectUri));
    const { body: session } = await request("POST", "/api/auth/oidc/complete", {
      body: { transaction: challenge.transaction, callbackUrl: redirect.location },
    });
    assert.equal(session.email, "sso-person@penny.test");
    const me = await request("GET", "/api/auth/me", { token: session.token });
    assert.equal(me.body.email, "sso-person@penny.test");

    // Controllable provider failure: an unverified email is refused.
    const refusal = await new Promise((resolve, reject) => {
      const body = JSON.stringify({ emailVerified: false });
      const put = httpsRequest(`${provider.issuer}/control`, {
        ca, method: "PUT", headers: { "X-Penny-Test-Token": state.controlToken, "content-type": "application/json" },
      }, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      put.on("error", reject);
      put.end(body);
    });
    assert.equal(refusal, 200);
    const second = (await request("POST", "/api/auth/oidc/start", { body: { redirectUri } })).body;
    const denied = await getRedirect(new URL(second.authorizationUrl), ca);
    const failed = await request("POST", "/api/auth/oidc/complete", {
      body: { transaction: second.transaction, callbackUrl: denied.location }, expect: [400, 401, 403],
    });
    assert.ok(failed.status >= 400);
  } finally {
    await provider.close();
  }
});
