#!/usr/bin/env node
// Production container smoke test (MAZ-63). Starts deploy/compose.yaml with the
// given images under a throwaway project, then checks: same-origin web and API,
// readiness, correlation ids, cookies/CORS through the proxy, restart and volume
// durability, receipt-volume permission and PostgreSQL loss/recovery, runtime-grant
// repair, backup and restore into a clean environment, search after an index rebuild
// and the missing-extension guard. Everything is synthetic and removed afterwards.
//
//   PENNY_SMOKE_API_IMAGE=localhost/penny-api:dev PENNY_SMOKE_WEB_IMAGE=localhost/penny-web:dev \
//     node scripts/deploy-smoke.mjs
//
// PENNY_COMPOSE overrides the compose command (default "docker compose");
// PENNY_SMOKE_KEEP=1 leaves the environment running after a failure.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";
import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const apiImage = process.env.PENNY_SMOKE_API_IMAGE ?? "localhost/penny-api:dev";
const webImage = process.env.PENNY_SMOKE_WEB_IMAGE ?? "localhost/penny-web:dev";
const composeCommand = (process.env.PENNY_COMPOSE ?? "docker compose").split(" ");
const id = randomBytes(4).toString("hex");
const project = `penny-smoke-${id}`;
const directory = path.join(root, ".cache", "deploy-smoke", id);
const envFile = path.join(directory, ".env");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function compose(args, { input, allowFailure = false, binary = false } = {}) {
  const [command, ...prefix] = composeCommand;
  const result = spawnSync(
    command,
    [...prefix, "-p", project, "-f", path.join(root, "deploy", "compose.yaml"), "--env-file", envFile, ...args],
    { input, maxBuffer: 256 * 1024 * 1024, encoding: binary ? "buffer" : "utf8" },
  );
  if (result.status !== 0 && !allowFailure) {
    const stderr = binary ? result.stderr.toString() : result.stderr;
    throw new Error(`compose ${args.join(" ")} failed (${result.status}): ${stderr.slice(-2000)}`);
  }
  return result;
}

let origin = "";
async function http(pathname, { method = "GET", body, token, cookie, headers = {} } = {}) {
  const response = await fetch(origin + pathname, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, headers: response.headers, text, json };
}

function check(condition, message, detail = "") {
  if (!condition) throw new Error(`not ok - ${message}${detail ? `: ${detail}` : ""}`);
  console.log(`ok - ${message}`);
}

async function waitFor(description, probe, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await probe();
      if (last === true) return;
    } catch (error) {
      last = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`not ok - ${description} (timed out; last: ${JSON.stringify(last)})`);
}

const ready = () => http("/api/ready").then((r) => r.status === 200 || r.text);
const notReady = (fragment) => () =>
  http("/api/ready").then((r) => (r.status === 503 && r.text.includes(fragment)) || `${r.status} ${r.text}`);

function psql(sql) {
  return compose(["exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "penny", "-v", "ON_ERROR_STOP=1", "-c", sql]);
}

function findUserId(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findUserId(item);
      if (found) return found;
    }
  } else if (value && typeof value === "object") {
    if (typeof value.userId === "string") return value.userId;
    for (const item of Object.values(value)) {
      const found = findUserId(item);
      if (found) return found;
    }
  }
  return undefined;
}

async function main() {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const port = await freePort();
  origin = `http://localhost:${port}`;
  const init = spawnSync("sh", [path.join(root, "deploy", "init-env.sh"), origin], {
    env: { ...process.env, PENNY_ENV_FILE: envFile },
    encoding: "utf8",
  });
  if (init.status !== 0) throw new Error(`init-env.sh failed: ${init.stderr}`);
  appendFileSync(
    envFile,
    [
      `PENNY_API_IMAGE=${apiImage}`,
      `PENNY_WEB_IMAGE=${webImage}`,
      `PENNY_PORT=${port}`,
      `PENNY_SUBNET=172.31.${64 + (randomBytes(1)[0] % 180)}.0/24`,
      "",
    ].join("\n"),
  );
  const up = () => compose(["up", "-d", "--wait", "--no-build", "--pull", "never"]);

  console.log(`# ${project} on ${origin} (api ${apiImage}, web ${webImage})`);
  up();
  check(true, "stack started: postgres healthy, migrate completed, api and web healthy");
  const migrateLog = compose(["logs", "--no-log-prefix", "migrate"]).stdout;
  check(migrateLog.includes("Runtime grants applied."), "migration applied runtime grants");

  // Same origin: static app, SPA fallback and the API behind one port.
  const page = await http("/");
  check(page.status === 200 && (page.headers.get("content-type") ?? "").includes("text/html"), "web app served");
  check(page.headers.get("cache-control") === "no-cache", "index.html is not cached");
  const deep = await http("/households/does-not-exist");
  check(deep.status === 200 && deep.text === page.text, "deep links fall back to index.html");
  const readyResponse = await http("/api/ready", { headers: { "x-request-id": "client supplied" } });
  check(readyResponse.status === 200, "API ready through the proxy");
  check(/^[0-9a-f]{32}$/.test(readyResponse.headers.get("x-request-id") ?? ""), "proxy request id echoed by the API");
  const published = (service) =>
    compose(["ps", "--format", "json", service])
      .stdout.trim()
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => [JSON.parse(line)].flat())
      .flatMap((container) => container.Publishers ?? [])
      .filter((publisher) => publisher.PublishedPort > 0);
  check(published("api").length === 0 && published("postgres").length === 0, "API and PostgreSQL ports are not published");
  check(published("web").length === 1, "only the web port is published");

  // Cookies, origin policy and CORS through the proxy.
  const email = `smoke-${id}@example.test`;
  const password = `smoke password ${id}`;
  const foreign = await http("/api/auth/register", {
    method: "POST",
    body: { email: `x${email}`, password },
    headers: { origin: "https://attacker.example" },
  });
  check(foreign.status === 403, "foreign origin rejected", String(foreign.status));
  const registered = await http("/api/auth/register", { method: "POST", body: { email, password }, headers: { origin } });
  check(registered.status === 201, "registration through the proxy", registered.text);
  const token = registered.json.token;
  const setCookie = registered.headers.get("set-cookie") ?? "";
  check(/HttpOnly/i.test(setCookie) && /SameSite=(Lax|Strict)/i.test(setCookie), "session cookie is HttpOnly with SameSite", setCookie.replace(/=[^;]*/, "=<redacted>"));
  const cookie = setCookie.split(";")[0];
  const preflight = await fetch(`${origin}/api/ledger`, {
    method: "OPTIONS",
    headers: { origin, "access-control-request-method": "PUT", "access-control-request-headers": "content-type" },
  });
  check(
    preflight.status === 204 &&
      preflight.headers.get("access-control-allow-origin") === origin &&
      preflight.headers.get("access-control-allow-credentials") === "true",
    "CORS preflight allows the public origin with credentials",
    String(preflight.status),
  );
  check((await http("/api/auth/me", { cookie })).status === 200, "cookie session works through the proxy");

  // Synthetic data: a household, a shared expense and an encrypted receipt.
  const household = await http("/api/households", { method: "POST", token, body: { name: "Smoke home", currency: "CAD" } });
  check(household.status === 201, "household created", household.text);
  const householdId = household.json.household.id;
  const detail = await http(`/api/households/${householdId}`, { token });
  const userId = findUserId(detail.json);
  check(typeof userId === "string", "member id read from household detail");
  const expense = await http(`/api/households/${householdId}/expenses`, {
    method: "POST",
    token,
    body: {
      title: "Zanzibar smoke picnic",
      totalCents: 4200,
      date: new Date().toISOString().slice(0, 10),
      payerUserId: userId,
      splitMode: "equal",
      category: { name: "Groceries", icon: "basket-outline", color: "#6C9C79" },
      note: "",
    },
  });
  check(expense.status === 201, "shared expense created", expense.text);
  const receiptBytes = Buffer.concat([Buffer.from("%PDF-1.4\n"), randomBytes(2048), Buffer.from("\n%%EOF\n")]);
  const receipt = await http("/api/receipts", {
    method: "POST",
    token,
    body: { name: "smoke.pdf", mime: "application/pdf", base64: receiptBytes.toString("base64") },
  });
  check(receipt.status === 201, "receipt uploaded to the volume", receipt.text);
  const receiptId = receipt.json.id;
  const searchFinds = async (bearer) => {
    const result = await http("/api/v1/search/transactions", { method: "POST", token: bearer, body: { query: "zanzibar" } });
    return (result.status === 200 && result.json.items.length > 0) || `${result.status} ${result.text}`;
  };
  await waitFor("search finds the expense", () => searchFinds(token), 30_000);
  check(true, "keyword search finds the expense");

  const dataSurvives = async (label) => {
    check((await http("/api/auth/me", { token })).status === 200, `${label}: session still valid`);
    const list = await http("/api/households", { token });
    check(list.json.households.some((h) => h.id === householdId), `${label}: household present`);
    const download = await fetch(`${origin}/api/receipts/${receiptId}`, { headers: { authorization: `Bearer ${token}` } });
    const bytes = Buffer.from(await download.arrayBuffer());
    check(download.status === 200 && bytes.equals(receiptBytes), `${label}: receipt decrypts to the same bytes`);
  };

  // Restart and recreate: data lives in the named volumes, not the containers.
  compose(["restart", "api"]);
  up();
  await waitFor("ready after API restart", ready);
  await dataSurvives("after API restart");
  compose(["down"]);
  up();
  await waitFor("ready after recreate", ready);
  await dataSurvives("after down/up");

  // Receipt volume not writable: readiness fails, liveness survives, then recovers.
  compose(["exec", "-T", "api", "chmod", "0500", "/var/lib/penny/receipts"]);
  await waitFor("readiness reports unwritable receipt storage", notReady("Receipts__Root"), 15_000);
  check((await http("/api/health")).status === 200, "liveness survives a receipt storage failure");
  compose(["exec", "-T", "api", "chmod", "0700", "/var/lib/penny/receipts"]);
  await waitFor("ready after fixing receipt permissions", ready, 15_000);
  check(true, "receipt permission failure detected and recovered");

  // PostgreSQL loss and recovery.
  compose(["stop", "postgres"]);
  await waitFor("readiness reports database loss", notReady("Database is unavailable"), 30_000);
  check((await http("/api/health")).status === 200, "liveness survives PostgreSQL loss");
  compose(["start", "postgres"]);
  await waitFor("ready after PostgreSQL returns", ready);
  await dataSurvives("after PostgreSQL recovery");

  // Missing runtime grants are reported, and re-running the migration repairs them.
  psql(`REVOKE SELECT ON penny."__EFMigrationsHistory" FROM penny_runtime`);
  await waitFor("readiness reports missing grants", notReady("grants"), 15_000);
  compose(["run", "--rm", "migrate"]);
  await waitFor("ready after re-running migrate", ready, 30_000);
  check(true, "runtime role failure detected and repaired by migrate --grant-runtime");

  // Backup: stop writers, dump the database, then archive receipts.
  compose(["stop", "web", "api"]);
  const dump = compose(["exec", "-T", "postgres", "pg_dump", "-U", "postgres", "-d", "penny", "--schema=penny", "--format=custom"], { binary: true }).stdout;
  check(dump.length > 1024, `database dump taken (${dump.length} bytes)`);
  const receipts = compose(
    ["run", "--rm", "--no-deps", "-T", "--entrypoint", "tar", "api", "-C", "/var/lib/penny/receipts", "-cf", "-", "."],
    { binary: true },
  ).stdout;
  check(receipts.length > 2048, `receipt archive taken (${receipts.length} bytes)`);

  // Restore into a clean environment: new volumes, roles and extensions from init.
  compose(["down", "-v"]);
  compose(["up", "-d", "--wait", "--no-build", "--pull", "never", "postgres"]);
  compose(["exec", "-T", "postgres", "pg_restore", "-U", "postgres", "-d", "penny", "--clean", "--if-exists", "--exit-on-error"], { input: dump });
  compose(["run", "--rm", "--no-deps", "-T", "--entrypoint", "tar", "api", "-C", "/var/lib/penny/receipts", "-xf", "-"], { input: receipts });
  up();
  await waitFor("ready after restore", ready);
  await dataSurvives("after restore into a clean environment");
  const login = await http("/api/auth/login", { method: "POST", body: { email, password }, headers: { origin } });
  check(login.status === 200, "password sign-in after restore", login.text);

  // Search projections are derived: rebuild, verify and query.
  const rebuild = compose(["exec", "-T", "api", "dotnet", "Penny.Backend.Api.dll", "search-rebuild"]);
  check(rebuild.status === 0, "search-rebuild completed");
  await waitFor("search-verify reports nothing stale", () => {
    const verify = compose(["exec", "-T", "api", "dotnet", "Penny.Backend.Api.dll", "search-verify"], { allowFailure: true });
    return verify.status === 0 || verify.stdout.trim();
  }, 60_000);
  check(true, "search-verify clean after rebuild");
  await waitFor("search after rebuild", () => searchFinds(token), 30_000);
  check(true, "search finds the restored expense after rebuild");

  // Missing extension: readiness explains it and migrate refuses to run.
  psql("DROP EXTENSION pg_trgm CASCADE");
  await waitFor("readiness reports missing extension", notReady("pg_trgm"), 15_000);
  const refused = compose(["run", "--rm", "migrate"], { allowFailure: true });
  check(refused.status !== 0, "migrate refuses a database without pg_trgm");
}

let failed = false;
try {
  await main();
  console.log("# all smoke checks passed");
} catch (error) {
  failed = true;
  console.error(error.message);
  try {
    console.error(compose(["logs", "--tail", "60"], { allowFailure: true }).stdout);
  } catch {
    // The environment may not have started.
  }
} finally {
  if (!(failed && process.env.PENNY_SMOKE_KEEP === "1")) {
    compose(["down", "-v", "--remove-orphans"], { allowFailure: true });
    rmSync(directory, { recursive: true, force: true });
  } else console.error(`Kept ${project}; env file ${envFile}`);
}
process.exit(failed ? 1 : 0);
