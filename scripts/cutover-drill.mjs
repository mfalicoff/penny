#!/usr/bin/env node
// Production-container cutover drill (MAZ-65). Runs docs/cutover.md end to end with
// the release images: the legacy Node/SQLite image, then deploy/compose.yaml plus
// deploy/compose.cutover.yaml, behind one stable address (a local switchable proxy
// standing in for the operator's TLS proxy):
//
//  1. Legacy serves the address. Synthetic users build ledgers, receipts, a household
//     with every split mode, a payment, a shared rule, a trip a member
//     left, a cookie session, a signed-out session and an Expo device. One device
//     keeps unsynced edits ("offline") through the cutover.
//  2. Freeze (the proxy answers 503), stop Node, record the source hash.
//  3. Attempt 1: migrate, copy and seal the source, dry run, import, verify. Then a no-go: discard the
//     target and receipt volume, check the source is unchanged, restart Node, and
//     confirm legacy reads and writes as before (rollback before reopening writes).
//  4. Attempt 2: freeze again, seal the new source, import, verify, start the API,
//     search rebuild/verify, receipts-verify. Go/no-go gates on the v2 port before
//     the switch: every recorded read equals legacy's, bearer and cookie sessions,
//     receipt bytes, search, signed-out session refused, scrypt password refused.
//  5. Switch the address to v2 (writes reopen). Write gates: ledger saves keep the
//     imported revision, the returning offline device gets 409 then merges with the
//     shipped client merge (src/domain/merge.ts) without losing either side, cookie
//     writes, shared expenses, legacy Expo device registration, password reset.
//  6. Restart drills (API, PostgreSQL), sealed-snapshot export and source retention.
//
// Writes test-results/cutover-drill/cutover-drill-report.{json,md} and exits 1 on
// any no-go. Everything is synthetic and removed afterwards.
//
//   PENNY_DRILL_LEGACY_IMAGE=localhost/penny-legacy:dev PENNY_DRILL_API_IMAGE=localhost/penny-api:dev \
//     PENNY_DRILL_WEB_IMAGE=localhost/penny-web:dev node scripts/cutover-drill.mjs
//
// PENNY_COMPOSE overrides the compose command (default "docker compose"), PENNY_DOCKER
// the container CLI (default "docker"); PENNY_DRILL_KEEP=1 keeps a failed run.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { differences } from "./test-env/compare.mjs";
import { knownDifferences, read, reads } from "./test-env/cutover.mjs";
import { deployEnv } from "./test-env/deploy-env.mjs";
import { freePort } from "./test-env/environment.mjs";
import { mergeLedger } from "../src/domain/merge.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const legacyImage = process.env.PENNY_DRILL_LEGACY_IMAGE ?? "localhost/penny-legacy:dev";
const apiImage = process.env.PENNY_DRILL_API_IMAGE ?? "localhost/penny-api:dev";
const webImage = process.env.PENNY_DRILL_WEB_IMAGE ?? "localhost/penny-web:dev";
const composeCommand = (process.env.PENNY_COMPOSE ?? "docker compose").split(" ");
const docker = process.env.PENNY_DOCKER ?? "docker";
const id = randomBytes(4).toString("hex");
const project = `penny-drill-${id}`;
const legacyContainer = `${project}-legacy`;
const legacyVolume = `${project}-legacy-data`;
const directory = path.join(root, ".cache", "cutover-drill", id);
const envFile = path.join(directory, ".env");
const reportDirectory = process.env.PENNY_DRILL_REPORT ?? path.join(root, "test-results", "cutover-drill");
const legacyDatabase = "/var/lib/penny/legacy/penny.sqlite";

const report = { started: new Date().toISOString(), images: { legacy: legacyImage, api: apiImage, web: webImage }, steps: [], gates: [], timings: {} };

function run(command, args, { input, allowFailure = false, binary = false } = {}) {
  const result = spawnSync(command, args, { input, maxBuffer: 256 * 1024 * 1024, encoding: binary ? "buffer" : "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    const stderr = binary ? result.stderr.toString() : result.stderr;
    throw new Error(`${command} ${args.slice(0, 12).join(" ")} failed (${result.status}): ${stderr.slice(-2000)}`);
  }
  return result;
}

const composeFiles = ["-f", path.join(root, "deploy", "compose.yaml"), "-f", path.join(root, "deploy", "compose.cutover.yaml")];
function compose(args, options) {
  const [command, ...prefix] = composeCommand;
  return run(command, [...prefix, "-p", project, ...composeFiles, "--env-file", envFile, ...args], options);
}

/** One `cutover` command (docs/cutover.md), recorded as a step with its exit code. */
function cutover(name, args, { allowed = [0] } = {}) {
  const started = Date.now();
  const result = compose(["run", "--rm", "-T", "cutover", ...args], { allowFailure: true });
  report.steps.push({ name, exit: result.status, seconds: (Date.now() - started) / 1000 });
  if (!allowed.includes(result.status))
    throw new Error(`${name} failed (${result.status}): ${result.stderr.trim().split("\n").slice(-3).join(" ")}`);
  return result;
}

function maintenance(name, args, { allowed = [0] } = {}) {
  const started = Date.now();
  const result = compose(["exec", "-T", "api", "dotnet", "Penny.Backend.Api.dll", ...args], { allowFailure: true });
  report.steps.push({ name, exit: result.status, seconds: (Date.now() - started) / 1000 });
  if (!allowed.includes(result.status)) throw new Error(`${name} failed (${result.status}): ${result.stdout.slice(-500)} ${result.stderr.slice(-500)}`);
  return result;
}

/** A go/no-go gate; any failure is a no-go and stops the drill. */
function gate(name, ok, detail = "") {
  report.gates.push({ name, ok: Boolean(ok), ...(detail ? { detail } : {}) });
  console.log(`${ok ? "ok" : "not ok"} - ${name}${detail && !ok ? `: ${detail}` : ""}`);
  if (!ok) throw new Error(`no-go: ${name}${detail ? `: ${detail}` : ""}`);
}

function step(name) {
  console.log(`# ${name}`);
  report.steps.push({ name, exit: 0 });
}

async function waitFor(description, probe, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await probe();
      if (last === true) return;
    } catch (error) {
      last = error.message;
    }
    await new Promise((done) => setTimeout(done, 1000));
  }
  throw new Error(`${description} timed out; last: ${JSON.stringify(last)}`);
}

// The stable address users and devices know. `target` is the upstream port, or
// undefined during a write freeze (every request then gets 503, like a maintenance page).
let target;
const frozenRequests = { count: 0 };
function startAddress(port) {
  const server = createServer((incoming, outgoing) => {
    if (!target) {
      frozenRequests.count++;
      incoming.resume();
      outgoing.writeHead(503, { "content-type": "application/json", "retry-after": "60" });
      outgoing.end(JSON.stringify({ error: "Penny is being upgraded. Try again in a few minutes." }));
      return;
    }
    const upstream = httpRequest(
      { host: "127.0.0.1", port: target, method: incoming.method, path: incoming.url, headers: incoming.headers },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    upstream.on("error", () => {
      if (!outgoing.headersSent) outgoing.writeHead(502, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ error: "upstream unavailable" }));
    });
    incoming.pipe(upstream);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

function client(base) {
  return async function request(method, pathname, { token, cookie, body, origin, expect = [200, 201] } = {}) {
    const response = await fetch(base + pathname, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(cookie ? { cookie } : {}),
        ...(origin ? { origin } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = text;
    }
    if (!expect.includes(response.status))
      throw new Error(`${method} ${pathname} returned ${response.status}: ${typeof json === "object" ? json?.error ?? text : text}`.slice(0, 400));
    return { status: response.status, body: json, headers: response.headers };
  };
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => today().slice(0, 7);
const nextMonthDay = (dayOfMonth) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, dayOfMonth)).toISOString().slice(0, 10);
};

function legacyFile(args) {
  return run(docker, ["run", "--rm", "--network", "none", "-v", `${legacyVolume}:/data:ro`, "--entrypoint", "sh", legacyImage, "-c", args]);
}
const legacySourceHash = () => legacyFile("sha256sum /data/penny.sqlite").stdout.split(/\s+/)[0];
const legacyFiles = () => legacyFile("ls -1 /data").stdout.trim().split("\n").filter(Boolean);

async function startLegacy(origin, port) {
  run(docker, ["run", "-d", "--name", legacyContainer, "-p", `127.0.0.1:${port}:3001`, "-v", `${legacyVolume}:/data`,
    "-e", `CORS_ORIGINS=${origin}`, "-e", "COOKIE_SECURE=false", "-e", "NODE_ENV=production", legacyImage]);
  await waitFor("legacy health", async () => (await fetch(`http://127.0.0.1:${port}/api/health`)).ok);
}

// Stop Node cleanly: SIGTERM closes the database, which checkpoints and removes the WAL.
function stopLegacy() {
  run(docker, ["stop", "--time", "30", legacyContainer]);
}

/** Synthetic, production-shaped legacy data, written through the legacy HTTP API. */
async function seedLegacy(request) {
  const context = { users: {}, userIds: {}, households: {}, expenses: [], receipts: [], months: [thisMonth()], expiredToken: undefined };
  const words = ["Épicerie", "Café crème", "Boulangerie", "Pharmacie", "Essence", "東京 ramen", "Pizza 🍕", "Loyer"];
  let state = 65;
  const next = () => ((state = (state * 1103515245 + 12345) >>> 0) / 4294967296);
  const pick = (items) => items[Math.floor(next() * items.length)];
  for (const [alias, size] of [["u00", 400], ["u01", 120], ["u02", 30], ["u05", 0]]) {
    const email = `${alias}.${id}@penny.test`;
    const password = randomBytes(12).toString("hex");
    const { body } = await request("POST", "/api/auth/register", { body: { email, password }, expect: [201] });
    context.users[alias] = { email, password, token: body.token, size };
  }
  // A cookie session (the web app) and a signed-out session that must stay refused.
  const login = await request("POST", "/api/auth/login", { body: { email: context.users.u01.email, password: context.users.u01.password } });
  context.cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  const signedOut = await request("POST", "/api/auth/login", { body: { email: context.users.u02.email, password: context.users.u02.password } });
  await request("POST", "/api/auth/logout", { token: signedOut.body.token });
  context.expiredToken = signedOut.body.token;

  for (const [alias, user] of Object.entries(context.users)) {
    const receipts = [];
    for (let count = 0; count < (alias === "u00" ? 2 : alias === "u01" ? 1 : 0); count++) {
      const content = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(1024 + count * 777), Buffer.from("\n%%EOF\n")]);
      const { body } = await request("POST", "/api/receipts", {
        token: user.token, body: { name: `Reçu ${alias} ${count}.pdf`, mime: "application/pdf", base64: content.toString("base64") }, expect: [201],
      });
      receipts.push(body.id);
      context.receipts.push({ alias, id: body.id, sha256: sha256(content) });
    }
    const current = await request("GET", "/api/ledger", { token: user.token });
    const ledger = current.body.ledger;
    ledger.categories.push({ id: "custom-food", name: "Food", icon: "pricetag-outline", color: "#678DB1", kind: "expense" });
    ledger.accounts = alias === "u05" ? [] : [{ id: "acct-0", name: "Compte courant", type: "bank" }, { id: "acct-1", name: "Visa", type: "credit" }];
    ledger.trips = alias === "u00" ? [{ id: "trip-0", name: "Vacances", startDate: "2025-07-01", endDate: "2025-07-14" }] : [];
    ledger.transactions = Array.from({ length: user.size }, (_, n) => {
      const total = 100 + Math.floor(next() * 50_000);
      const kind = n % 17 === 0 ? "income" : "expense";
      return {
        id: `${alias}-e${n}`, title: `${pick(words)} ${n}`, kind, total,
        share: kind === "income" ? total : Math.max(1, Math.floor(total * (n % 4 ? 1 : 0.5))),
        categoryId: kind === "income" ? "salary" : "custom-food",
        date: new Date(Date.UTC(2023, 0, 1) + n * 86_400_000).toISOString().slice(0, 10),
        note: n % 9 === 0 ? "Note synthétique" : "",
        ...(ledger.accounts.length && n % 3 === 0 ? { accountId: "acct-0" } : {}),
        ...(ledger.trips.length && kind === "expense" && n % 11 === 0 ? { tripId: "trip-0" } : {}),
        ...(n < receipts.length ? { receipt: { id: receipts[n], name: `Reçu ${alias} ${n}.pdf`, mime: "application/pdf", uri: "" } } : {}),
      };
    });
    await request("PUT", "/api/ledger", { token: user.token, body: { revision: current.body.revision, ledger } });
  }

  const join = async (household, creator, alias) => {
    const { body } = await request("POST", `/api/households/${household}/invites`, { token: context.users[creator].token, expect: [201] });
    await request("POST", "/api/households/join", { token: context.users[alias].token, body: { code: body.code, timezoneOffsetMinutes: 0 } });
  };
  const learn = async (household, alias) => {
    const { body } = await request("GET", `/api/households/${household}`, { token: context.users[alias].token });
    for (const member of body.members)
      for (const [name, user] of Object.entries(context.users)) if (user.email === member.email) context.userIds[name] = member.userId;
  };
  const { body: created } = await request("POST", "/api/households", { token: context.users.u00.token, expect: [201], body: { name: "Maison", currency: "CAD", timezoneOffsetMinutes: 0 } });
  const maison = created.household.id;
  context.households.Maison = maison;
  await join(maison, "u00", "u01");
  await join(maison, "u00", "u02");
  await learn(maison, "u00");
  const members = ["u00", "u01", "u02"];
  const expense = async (household, payer, mode, totalCents, eligible) => {
    const ids = eligible.map((alias) => context.userIds[alias]);
    const allocations = mode === "exact"
      ? ids.map((userId, n) => ({ userId, amountCents: n === 0 ? totalCents - Math.floor(totalCents / ids.length) * (ids.length - 1) : Math.floor(totalCents / ids.length) }))
      : mode === "percent"
        ? ids.map((userId, n) => ({ userId, percentBasisPoints: n === 0 ? 10_000 - Math.floor(10_000 / ids.length) * (ids.length - 1) : Math.floor(10_000 / ids.length) }))
        : undefined;
    const { body } = await request("POST", `/api/households/${household}/expenses`, {
      token: context.users[payer].token, expect: [201],
      body: { title: `${pick(words)} partagé`, totalCents, date: today(), payerUserId: context.userIds[payer], splitMode: mode,
        ...(allocations ? { allocations } : {}), category: { name: "Courses", icon: "cart-outline", color: "#E47850" }, note: "" },
    });
    context.expenses.push({ household, id: body.expense.id });
    return body.expense;
  };
  for (const [n, mode] of ["equal", "exact", "percent", "equal", "exact", "equal"].entries())
    await expense(maison, members[n % 3], mode, 1_000 + n * 1_234, members);
  const paid = await expense(maison, "u00", "equal", 9_000, members);
  await request("POST", `/api/households/${maison}/expenses/${paid.id}/payments`, {
    token: context.users.u01.token, expect: [201], body: { fromUserId: context.userIds.u01, revision: paid.revision },
  });
  // Reimbursements need a month-end clock; the full-stack rehearsal (test-env/cutover.mjs)
  // covers settled and overdue months. The open month's recap is still compared.
  await request("POST", `/api/households/${maison}/recurring`, {
    token: context.users.u00.token, expect: [201],
    body: { title: "Loyer partagé", totalCents: 180_000, payerUserId: context.userIds.u00, splitMode: "equal",
      category: { name: "Logement", icon: "home-outline", color: "#678DB1" }, note: "", nextDate: nextMonthDay(3), frequency: "monthly" },
  });

  const start = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  const { body: trip } = await request("POST", "/api/households/trips", {
    token: context.users.u01.token, expect: [201], body: { name: "Lisbonne", currency: "CAD", timezoneOffsetMinutes: 0, startDate: start, endDate: nextMonthDay(1) },
  });
  context.households.Lisbonne = trip.household.id;
  await join(trip.household.id, "u01", "u05");
  await learn(trip.household.id, "u01");
  await expense(trip.household.id, "u01", "equal", 4_200, ["u01", "u05"]);
  await request("POST", `/api/households/${trip.household.id}/leave`, { token: context.users.u05.token, expect: [200, 409] });
  // Expo devices last, so legacy has nothing to deliver before the freeze.
  await request("POST", "/api/push/devices", { token: context.users.u00.token, expect: [201], body: { token: `ExponentPushToken[drill${id}]`, platform: "ios" } });
  return context;
}

/** The offline device: last synced `base`, plus edits it has not uploaded yet. */
async function offlineDevice(request, token) {
  const { body } = await request("GET", "/api/ledger", { token });
  const base = structuredClone(body.ledger);
  const local = structuredClone(body.ledger);
  local.transactions[1].title = "Modifié hors ligne";
  local.transactions = local.transactions.filter((entry) => entry.id !== local.transactions[2].id);
  local.transactions.push({ id: `offline-${id}`, title: "Saisi hors ligne", kind: "expense", total: 1234, share: 1234,
    categoryId: "custom-food", date: today(), note: "" });
  return { revision: body.revision, base, local, edited: base.transactions[1].id, deleted: base.transactions[2].id };
}

async function compareReads(base, plan, recorded, context) {
  const found = [];
  for (const [index, item] of plan.entries()) {
    const left = structuredClone(recorded[index]);
    const right = await read(base, item);
    for (const known of knownDifferences) known.adjust?.(left.body, right.body, context.userIds[item.alias]);
    for (const difference of differences(left, right).filter((d) => !knownDifferences.some((known) => known.path?.test(d.path))))
      found.push(`${item.name} ${difference.path}: legacy ${JSON.stringify(difference.legacy)} vs .NET ${JSON.stringify(difference.dotnet)}`);
  }
  return found;
}

async function receiptsMatch(base, context) {
  for (const receipt of context.receipts) {
    const response = await fetch(`${base}/api/receipts/${receipt.id}`, { headers: { authorization: `Bearer ${context.users[receipt.alias].token}` } });
    if (!response.ok || sha256(Buffer.from(await response.arrayBuffer())) !== receipt.sha256) return false;
  }
  return true;
}

/** Steps 2–6 of docs/cutover.md: copy, seal, dry run, import and verify into an empty target. */
function importAttempt(label, sourceHash) {
  compose(["up", "-d", "--wait", "--no-build", "--pull", "never", "postgres"]);
  const migrated = compose(["run", "--rm", "-T", "migrate"], { allowFailure: true });
  report.steps.push({ name: `${label}: migrate --grant-runtime`, exit: migrated.status });
  if (migrated.status !== 0) throw new Error(`migrate failed: ${migrated.stderr.slice(-500)}`);
  // The legacy database is in WAL mode, which SQLite cannot open from a read-only
  // directory, so the cleanly closed file is copied byte for byte and sealed from there.
  const copy = `/var/lib/penny/cutover/source-${label}.sqlite`;
  const copied = compose(["run", "--rm", "-T", "--entrypoint", "sh", "cutover", "-c", `cp ${legacyDatabase} ${copy} && sha256sum ${copy}`], { allowFailure: true });
  report.steps.push({ name: `${label}: copy source`, exit: copied.status });
  if (copied.status !== 0) throw new Error(`copying the source failed: ${copied.stderr.slice(-500)}`);
  gate(`${label}: the copied source equals the stopped legacy file`, copied.stdout.split(/\s+/)[0] === sourceHash);
  const sealed = `/var/lib/penny/cutover/sealed-${label}.sqlite`;
  const snapshot = cutover(`${label}: snapshot-sqlite`, ["snapshot-sqlite", copy, sealed]);
  const hash = snapshot.stdout.match(/[0-9a-f]{64}/i)?.[0];
  if (!hash) throw new Error("snapshot-sqlite printed no SHA-256.");
  cutover(`${label}: import-sqlite --dry-run`, ["import-sqlite", sealed, "--sha256", hash, "--dry-run"]);
  const started = Date.now();
  const imported = cutover(`${label}: import-sqlite`, ["import-sqlite", sealed, "--sha256", hash]);
  report.timings[`${label}ImportSeconds`] = (Date.now() - started) / 1000;
  cutover(`${label}: import-sqlite --verify`, ["import-sqlite", sealed, "--sha256", hash, "--verify"]);
  return { sealed, hash: hash.toLowerCase(), tables: JSON.parse(imported.stdout.trim().split("\n").at(-1)) };
}

async function main() {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const [addressPort, legacyPort, webPort] = [await freePort(), await freePort(), await freePort()];
  const origin = `http://localhost:${addressPort}`;
  const address = await startAddress(addressPort);
  const atAddress = client(origin);
  const v2 = `http://127.0.0.1:${webPort}`;
  const atV2 = client(v2);
  try {
    writeFileSync(envFile, deployEnv(origin, { PENNY_API_IMAGE: apiImage, PENNY_WEB_IMAGE: webImage, PENNY_PORT: webPort,
      PENNY_SUBNET: `172.31.${64 + (randomBytes(1)[0] % 180)}.0/24`, PENNY_LEGACY_VOLUME: legacyVolume }), { mode: 0o600 });
    console.log(`# ${project}: address ${origin}, legacy :${legacyPort}, v2 web :${webPort}`);

    // 1. Legacy serves the address.
    let started = Date.now();
    run(docker, ["volume", "create", legacyVolume]);
    await startLegacy(origin, legacyPort);
    target = legacyPort;
    const context = await seedLegacy(atAddress);
    const offline = await offlineDevice(atAddress, context.users.u00.token);
    const plan = reads(context);
    plan.push({ name: "u01 me (cookie)", path: "/api/auth/me", token: undefined, cookie: context.cookie, alias: "u01" });
    const readWithCookie = (base, item) => item.cookie
      ? fetch(base + item.path, { headers: { cookie: item.cookie } }).then(async (r) => ({ status: r.status, body: await r.json() }))
      : read(base, item);
    const recorded = [];
    for (const item of plan) recorded.push(await readWithCookie(origin, item));
    gate("legacy returns every uploaded receipt byte for byte", await receiptsMatch(origin, context));
    report.timings.seedSeconds = (Date.now() - started) / 1000;
    step(`legacy dataset: ${Object.keys(context.users).length} users, ${context.expenses.length} shared expenses, ${context.receipts.length} receipts, ${plan.length} recorded reads`);

    // 2. Freeze, then stop Node.
    target = undefined;
    const frozen = await atAddress("POST", "/api/ledger", { token: context.users.u00.token, body: {}, expect: [503] });
    gate("write freeze: the address refuses writes before Node stops", frozen.status === 503);
    stopLegacy();
    gate("Node stopped cleanly: no SQLite WAL or shared-memory file left", !legacyFiles().some((name) => /-(wal|shm)$/.test(name)), legacyFiles().join(","));
    const sourceBefore = legacySourceHash();

    // 3. Attempt 1, then a deliberate no-go: roll back before reopening writes.
    started = Date.now();
    importAttempt("attempt-1", sourceBefore);
    step("no-go declared before reopening writes: discard the PostgreSQL target and receipt volume (the failed snapshot stays in penny-cutover)");
    compose(["down", "-v", "--remove-orphans"]);
    gate("rollback: the legacy source is unchanged by the attempt", legacySourceHash() === sourceBefore);
    run(docker, ["start", legacyContainer]);
    await waitFor("legacy health after rollback", async () => (await fetch(`http://127.0.0.1:${legacyPort}/api/health`)).ok);
    target = legacyPort;
    const afterRollback = [];
    for (const item of plan) afterRollback.push(await readWithCookie(origin, item));
    const rollbackDiffs = plan.flatMap((item, index) => differences(recorded[index], afterRollback[index]).map((d) => `${item.name} ${d.path}`));
    gate("rollback: every legacy read is unchanged on the resumed Node server", rollbackDiffs.length === 0, rollbackDiffs.slice(0, 5).join("; "));
    // Writes resume on legacy; the next attempt must carry them.
    const resumed = await atAddress("GET", "/api/ledger", { token: context.users.u02.token });
    resumed.body.ledger.transactions.push({ id: `after-rollback-${id}`, title: "Après le retour", kind: "expense", total: 777, share: 777, categoryId: "custom-food", date: today(), note: "" });
    const resumedSave = await atAddress("PUT", "/api/ledger", { token: context.users.u02.token, body: { revision: resumed.body.revision, ledger: resumed.body.ledger } });
    gate("rollback: legacy accepts writes again", resumedSave.status === 200);
    const u02Ledger = plan.findIndex((item) => item.name === "u02 ledger");
    recorded[u02Ledger] = await read(origin, plan[u02Ledger]);
    report.timings.rollbackSeconds = (Date.now() - started) / 1000;

    // 4. Attempt 2: freeze again, import, verify and gate before the switch.
    started = Date.now();
    target = undefined;
    stopLegacy();
    const sourceFinal = legacySourceHash();
    gate("attempt 2: the source changed only by the post-rollback write", sourceFinal !== sourceBefore);
    const second = importAttempt("attempt-2", sourceFinal);
    compose(["up", "-d", "--wait", "--no-build", "--pull", "never"]);
    await waitFor("v2 ready", async () => (await fetch(`${v2}/api/ready`)).status === 200);
    maintenance("search-rebuild", ["search-rebuild"]);
    await waitFor("search-verify clean", () => {
      const verify = compose(["exec", "-T", "api", "dotnet", "Penny.Backend.Api.dll", "search-verify"], { allowFailure: true });
      return verify.status === 0 || verify.stdout.trim();
    }, 90_000);
    report.steps.push({ name: "search-verify", exit: 0 });
    const receiptsVerify = maintenance("receipts-verify", ["receipts-verify"]);
    const resetCode = maintenance("reset-password (imported password account)", ["reset-password", context.users.u02.email]).stdout.trim();
    report.timings.cutoverSeconds = (Date.now() - started) / 1000;

    const readDiffs = [];
    for (const [index, item] of plan.entries()) {
      if (item.cookie) continue;
      readDiffs.push(...await compareReads(v2, [item], [recorded[index]], context));
    }
    report.readDifferences = readDiffs;
    gate(`every recorded legacy read equals .NET with the imported bearer sessions (${plan.length - 1} reads)`, readDiffs.length === 0, readDiffs.slice(0, 5).join("; "));
    const cookieMe = await fetch(`${v2}/api/auth/me`, { headers: { cookie: context.cookie } });
    gate("imported cookie session works on .NET", cookieMe.status === 200);
    gate("signed-out legacy session stays refused", (await atV2("GET", "/api/auth/me", { token: context.expiredToken, expect: [401] })).status === 401);
    gate("every receipt decrypts to the legacy bytes", await receiptsMatch(v2, context));
    gate("receipts-verify reports every receipt verified", JSON.parse(receiptsVerify.stdout).Verified === context.receipts.length, receiptsVerify.stdout.trim());
    const search = await atV2("POST", "/api/v1/search/transactions", { token: context.users.u00.token, body: { query: "boulangerie" } });
    gate("search finds imported entries", search.body.totalCount > 0);
    const scrypt = await atV2("POST", "/api/auth/login", { body: { email: context.users.u02.email, password: context.users.u02.password }, expect: [200, 401] });
    gate("imported scrypt password is refused until reset (documented)", scrypt.status === 401);

    // 5. Switch the address to v2: writes reopen.
    target = webPort;
    const ready = await atAddress("GET", "/api/ready");
    gate("the existing address serves v2 after the switch", ready.status === 200);
    const synced = await atAddress("GET", "/api/ledger", { token: context.users.u00.token });
    gate("ledger revision continues from legacy", synced.body.revision === offline.revision, `${synced.body.revision} vs ${offline.revision}`);
    // Another device of the same user saves first on .NET.
    const other = structuredClone(synced.body.ledger);
    other.transactions.push({ id: `other-device-${id}`, title: "Autre appareil", kind: "expense", total: 500, share: 500, categoryId: "custom-food", date: today(), note: "" });
    const otherSave = await atAddress("PUT", "/api/ledger", { token: context.users.u00.token, body: { revision: synced.body.revision, ledger: other } });
    gate("ledger write with an imported bearer session", otherSave.status === 200 && otherSave.body.revision === synced.body.revision + 1);
    // The offline device returns with edits made before the freeze.
    const stale = await atAddress("PUT", "/api/ledger", { token: context.users.u00.token, body: { revision: offline.revision, ledger: offline.local }, expect: [200, 409] });
    gate("returning offline device: stale revision is refused with 409, nothing overwritten", stale.status === 409);
    const remote = await atAddress("GET", "/api/ledger", { token: context.users.u00.token });
    const merged = mergeLedger(offline.base, offline.local, remote.body.ledger);
    const mergedSave = await atAddress("PUT", "/api/ledger", { token: context.users.u00.token, body: { revision: remote.body.revision, ledger: merged } });
    const final = (await atAddress("GET", "/api/ledger", { token: context.users.u00.token })).body.ledger.transactions;
    const has = (entryId) => final.some((entry) => entry.id === entryId);
    gate("returning offline device: merged save keeps its pending edits and the other device's", mergedSave.status === 200
      && has(`offline-${id}`) && has(`other-device-${id}`) && !has(offline.deleted)
      && final.find((entry) => entry.id === offline.edited)?.title === "Modifié hors ligne");
    const cookieLedger = await atAddress("GET", "/api/ledger", { cookie: context.cookie });
    cookieLedger.body.ledger.transactions.push({ id: `web-${id}`, title: "Saisi sur le web", kind: "expense", total: 900, share: 900, categoryId: "custom-food", date: today(), note: "" });
    const cookieSave = await atAddress("PUT", "/api/ledger", { cookie: context.cookie, origin, body: { revision: cookieLedger.body.revision, ledger: cookieLedger.body.ledger } });
    gate("ledger write with an imported cookie session from the public origin", cookieSave.status === 200);
    const shared = await atAddress("POST", `/api/households/${context.households.Maison}/expenses`, {
      token: context.users.u01.token, expect: [201],
      body: { title: "Après la bascule", totalCents: 3_000, date: today(), payerUserId: context.userIds.u01, splitMode: "equal",
        category: { name: "Courses", icon: "cart-outline", color: "#E47850" }, note: "" },
    });
    const seen = await atAddress("GET", `/api/households/${context.households.Maison}/expenses/${shared.body.expense.id}`, { token: context.users.u02.token });
    gate("shared expense written after the switch is visible to the other members", seen.status === 200);
    const device = await atAddress("POST", "/api/push/devices", { token: context.users.u01.token, expect: [201], body: { token: `ExponentPushToken[late${id}]`, platform: "android" } });
    gate("current Expo clients can still register Expo push devices", device.status === 201);
    const newPassword = randomBytes(12).toString("hex");
    await atAddress("POST", "/api/auth/password-reset", { body: { token: resetCode, password: newPassword } });
    const signIn = await atAddress("POST", "/api/auth/login", { body: { email: context.users.u02.email, password: newPassword } });
    gate("imported password account signs in after redeeming its reset code", signIn.status === 200);

    // 6. Restarts, sealed-snapshot export and source retention.
    compose(["restart", "api"]);
    await waitFor("ready after API restart", async () => (await fetch(`${origin}/api/ready`)).status === 200);
    gate("after an API restart, imported sessions and new writes remain", (await atAddress("GET", `/api/households/${context.households.Maison}/expenses/${shared.body.expense.id}`, { token: context.users.u00.token })).status === 200);
    compose(["restart", "postgres"]);
    await waitFor("ready after PostgreSQL restart", async () => (await fetch(`${origin}/api/ready`)).status === 200);
    gate("after a PostgreSQL restart, the merged ledger is intact", (await atAddress("GET", "/api/ledger", { token: context.users.u00.token })).body.ledger.transactions.some((entry) => entry.id === `offline-${id}`));
    const exported = compose(["run", "--rm", "--no-deps", "-T", "--entrypoint", "cat", "cutover", second.sealed], { binary: true }).stdout;
    gate("sealed snapshot exports from penny-cutover with its recorded hash", sha256(exported) === second.hash);
    gate("legacy volume retained unchanged as the sealed source", legacySourceHash() === sourceFinal);
    report.importedTables = second.tables;
    report.frozenRequests = frozenRequests.count;
  } finally {
    address.close();
  }
}

function writeReport(failure) {
  report.finished = new Date().toISOString();
  report.go = !failure && report.gates.every((item) => item.ok);
  if (failure) report.failure = failure;
  mkdirSync(reportDirectory, { recursive: true });
  writeFileSync(path.join(reportDirectory, "cutover-drill-report.json"), JSON.stringify(report, null, 2) + "\n");
  const lines = [
    "## Cutover drill (production containers)",
    "",
    `Decision: **${report.go ? "GO" : "NO-GO"}**${failure ? ` (${failure.replaceAll("|", "\\|")})` : ""}`,
    "",
    `Images: legacy \`${legacyImage}\`, API \`${apiImage}\`, web \`${webImage}\`.`,
    "",
    "| Step | Exit | Seconds |", "| --- | --- | --- |",
    ...report.steps.map((item) => `| ${item.name.replaceAll("|", "\\|")} | ${item.exit} | ${item.seconds?.toFixed(1) ?? ""} |`),
    "",
    "| Gate | Result |", "| --- | --- |",
    ...report.gates.map((item) => `| ${item.name} | ${item.ok ? "pass" : "**fail**"} |`),
    "",
    `Timings: ${Object.entries(report.timings).map(([name, value]) => `${name} ${value.toFixed(1)} s`).join(", ")}.`,
  ];
  const markdown = lines.join("\n") + "\n";
  writeFileSync(path.join(reportDirectory, "cutover-drill-report.md"), markdown);
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: "a" });
}

let failure;
try {
  await main();
  console.log("# GO: every cutover gate passed");
} catch (error) {
  failure = error.message;
  console.error(error.message);
  try {
    console.error(compose(["logs", "--tail", "60"], { allowFailure: true }).stdout);
    console.error(run(docker, ["logs", "--tail", "40", legacyContainer], { allowFailure: true }).stderr);
  } catch {
    // The environment may not have started.
  }
} finally {
  writeReport(failure);
  if (!(failure && process.env.PENNY_DRILL_KEEP === "1")) {
    compose(["--profile", "bundled-postgres", "--profile", "cutover", "down", "-v", "--remove-orphans"], { allowFailure: true });
    run(docker, ["rm", "-f", legacyContainer], { allowFailure: true });
    run(docker, ["volume", "rm", "-f", legacyVolume], { allowFailure: true });
    rmSync(directory, { recursive: true, force: true });
  } else console.error(`Kept ${project}; env file ${envFile}`);
}
process.exit(failure ? 1 : 0);
