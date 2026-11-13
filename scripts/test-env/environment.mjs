// Disposable full-stack test environments (MAZ-62): one pinned PostgreSQL container and
// one real .NET API process per run, isolated by run id. Nothing here accepts an
// external connection string: every run creates, uses and destroys its own database,
// so a test run cannot reach development or production data.
//
// PENNY_POSTGRES=native replaces the container with a private PostgreSQL 18 cluster that
// the run initializes in its own state directory, listening only on 127.0.0.1 and removed
// with the run, for hosts that cannot run Linux containers (GitHub-hosted macOS runners).
// It needs PostgreSQL 18 with pgvector 0.8+ binaries: PENNY_POSTGRES_BIN, or `pg_config`
// on PATH. The guarantee is the same: it never connects to a server it did not create.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const backend = join(root, "apps/backend");
export const stateRoot = join(root, ".cache/test-env");
export const label = "penny.test-run";
export const controlHeader = "X-Penny-Test-Token";
const modelDirectory = join(root, ".cache/backend/models/multilingual-e5-small");
const apiDll = join(backend, "src/Penny.Backend.Api/bin/Release/net10.0/Penny.Backend.Api.dll");

// Run ids name containers and databases, so they are restricted to a safe alphabet.
export function validRunId(value) {
  return typeof value === "string" && /^[a-z0-9]{4,24}$/.test(value);
}

export function newRunId() {
  return `r${randomBytes(5).toString("hex")}`;
}

export function databaseName(runId) {
  if (!validRunId(runId)) throw new Error(`Invalid run id: ${runId}`);
  return `penny_test_${runId}`;
}

// The PostgreSQL image is pinned once, in compose.yaml (and DatabaseSchema.Image).
export function postgresImage() {
  const compose = readFileSync(join(backend, "compose.yaml"), "utf8");
  const image = /^\s*image:\s*(\S+@sha256:[0-9a-f]{64})\s*$/m.exec(compose)?.[1];
  if (!image) throw new Error("apps/backend/compose.yaml has no digest-pinned PostgreSQL image.");
  return image;
}

export function containerCli() {
  const preferred = process.env.PENNY_CONTAINER_CLI;
  for (const cli of preferred ? [preferred] : ["docker", "podman"]) {
    const probe = spawnSync(cli, ["version"], { stdio: "ignore" });
    if (probe.status === 0) return cli;
  }
  throw new Error("A container runtime is required: install Docker or Podman (or set PENNY_CONTAINER_CLI).");
}

/**
 * `container` (default) or `native` (PENNY_POSTGRES).
 * @param {Record<string, string | undefined>} [environment]
 */
export function postgresMode(environment = process.env) {
  const mode = environment.PENNY_POSTGRES || "container";
  if (mode !== "container" && mode !== "native") {
    throw new Error(`PENNY_POSTGRES must be "container" or "native", not "${mode}".`);
  }
  return mode;
}

/**
 * The directory holding PostgreSQL 18's initdb, pg_ctl and psql for native mode:
 * PENNY_POSTGRES_BIN, else `pg_config --bindir`. The API refuses other major versions too;
 * checking here fails before a cluster is created.
 * @param {Record<string, string | undefined>} [environment]
 */
export function nativePostgresBin(environment = process.env) {
  let directory = environment.PENNY_POSTGRES_BIN;
  if (!directory) {
    const probe = spawnSync("pg_config", ["--bindir"], { encoding: "utf8" });
    if (probe.status !== 0) {
      throw new Error("PENNY_POSTGRES=native needs PostgreSQL 18: set PENNY_POSTGRES_BIN or put pg_config on PATH.");
    }
    directory = probe.stdout.trim();
  }
  for (const tool of ["initdb", "pg_ctl", "psql"]) {
    if (!existsSync(join(directory, tool))) throw new Error(`${join(directory, tool)} is missing (PENNY_POSTGRES_BIN).`);
  }
  const version = spawnSync(join(directory, "initdb"), ["--version"], { encoding: "utf8" }).stdout ?? "";
  if (!/\(PostgreSQL\) 18(\.|\s|$)/.test(version)) throw new Error(`PostgreSQL 18 is required for native mode, found: ${version.trim()}`);
  return directory;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    // Output may contain SQL or paths, never credentials (they travel in env or stdin).
    const detail = (result.stderr || result.stdout || "").trim().split("\n").slice(-5).join("\n");
    throw new Error(`${command} ${args[0]} failed (${result.status}): ${detail}`);
  }
  return result.stdout;
}

export function freePort(host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, host, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function statePath(runId) {
  return join(stateRoot, runId);
}

export function readState(runId) {
  const id = runId ?? currentRunId();
  if (!id) throw new Error("No test environment is running. Start one with `node scripts/test-env/penny-env.mjs up`.");
  const file = join(statePath(id), "env.json");
  if (!existsSync(file)) throw new Error(`Test environment ${id} has no state file.`);
  return JSON.parse(readFileSync(file, "utf8"));
}

export function currentRunId() {
  const file = join(stateRoot, "current");
  return existsSync(file) ? readFileSync(file, "utf8").trim() || undefined : undefined;
}

function writeState(state) {
  mkdirSync(statePath(state.runId), { recursive: true, mode: 0o700 });
  writeFileSync(join(statePath(state.runId), "env.json"), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(stateRoot, "current"), `${state.runId}\n`, { mode: 0o600 });
}

// The values a browser or simulator runner needs. The control token is included
// because runners call the controls; it is random per run and dies with the run.
export function runnerEnvironment(state) {
  return {
    PENNY_TEST_RUN: state.runId,
    PENNY_API_URL: state.apiUrl,
    PENNY_TEST_TOKEN: state.controlToken,
    // The provider's public, throwaway certificate: simulators trust it (scripts/ios.sh ui-test).
    ...(state.oidc ? { PENNY_OIDC_ISSUER: state.oidc.issuer, PENNY_OIDC_CERTIFICATE: state.oidc.certificate } : {}),
  };
}

async function waitFor(check, { timeoutMs, what }) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      if (error.fatal) throw error;
      last = error;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${what}${last ? `: ${last.message}` : ""}.`);
}

function processAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Native mode: initializes and starts the run's own cluster, then creates the database,
 * roles and extensions exactly as the container's init script does. Sets databasePort.
 */
async function startNativePostgres(state, secrets) {
  const bin = state.postgresBin;
  const passwordFile = join(state.directory, "initdb-password");
  writeFileSync(passwordFile, `${secrets.admin}\n`, { mode: 0o600 });
  try {
    run(join(bin, "initdb"), [
      "--pgdata", state.dataDirectory, "--username", "postgres", "--pwfile", passwordFile,
      "--auth", "scram-sha-256", "--encoding", "UTF8", "--locale-provider", "builtin", "--builtin-locale", "C.UTF-8",
    ]);
  } finally {
    rmSync(passwordFile, { force: true });
  }
  state.databasePort = await freePort();
  // TCP on loopback only and no Unix socket (state paths can exceed the socket path
  // limit); durability settings off, like the container's tmpfs: the data dies with the run.
  writeFileSync(join(state.dataDirectory, "postgresql.conf"), [
    "", "# penny test environment (scripts/test-env)",
    "listen_addresses = '127.0.0.1'", `port = ${state.databasePort}`, "unix_socket_directories = ''",
    "fsync = off", "synchronous_commit = off", "full_page_writes = off",
    // A failed statement is not echoed into the log: the role setup sets passwords, and the
    // log is collected as an artifact.
    "log_min_error_statement = panic", "",
  ].join("\n"), { flag: "a" });
  writeState(state);
  run(join(bin, "pg_ctl"), ["--pgdata", state.dataDirectory, "--log", state.postgresLog, "--wait", "--timeout", "60", "start"]);
  const env = {
    ...process.env, PATH: `${bin}:${process.env.PATH}`,
    PGHOST: "127.0.0.1", PGPORT: String(state.databasePort), PGPASSWORD: secrets.admin,
  };
  run(join(bin, "psql"), ["--username", "postgres", "--dbname", "postgres", "--set=ON_ERROR_STOP=1", "-q",
    "--command", `CREATE DATABASE "${state.database}"`], { env });
}

/**
 * The PID in a cluster's postmaster.pid, only while that process is still this cluster's
 * postmaster (its command line names the data directory): a stale file can name a reused PID.
 */
function postmasterPid(dataDirectory) {
  const file = join(dataDirectory, "postmaster.pid");
  if (!existsSync(file)) return undefined;
  const pid = Number(readFileSync(file, "utf8").split("\n")[0]);
  if (!Number.isInteger(pid) || pid <= 0 || !processAlive(pid)) return undefined;
  const command = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).stdout ?? "";
  return command.includes("postgres") && command.includes(dataDirectory) ? pid : undefined;
}

/**
 * Stops a native cluster left in a run directory, if one is running: with pg_ctl when the
 * binaries are known, otherwise by signalling an immediate shutdown to the verified postmaster.
 */
async function stopNativePostgres(dataDirectory, bin) {
  const pid = postmasterPid(dataDirectory);
  if (!pid) return;
  try {
    bin ??= nativePostgresBin();
  } catch {
    bin = undefined;
  }
  if (bin) {
    spawnSync(join(bin, "pg_ctl"), ["--pgdata", dataDirectory, "--mode", "immediate", "--wait", "stop"], { stdio: "ignore" });
  } else {
    try {
      process.kill(pid, "SIGQUIT");
    } catch {
      // Already gone.
    }
  }
  for (let attempt = 0; attempt < 40 && processAlive(pid); attempt++) await delay(250);
}

export function buildApi() {
  run("bash", [join(backend, "dotnet.sh"), "build", "src/Penny.Backend.Api", "--configuration", "Release"], {
    stdio: ["ignore", "ignore", "pipe"],
  });
}

/**
 * Starts an isolated environment and returns its state. On any failure everything
 * created so far is removed before the error is rethrown.
 * @param {{ runId?: string, host?: string, origins?: string[], build?: boolean,
 *   worker?: boolean, oidc?: { issuer: string, clientId: string, redirectUris: string[],
 *   certificate: string, allowRegistration?: boolean } }} options
 */
export async function up(options = {}) {
  const runId = options.runId ?? newRunId();
  if (!validRunId(runId)) throw new Error("Run ids use 4–24 lowercase letters or digits.");
  if (existsSync(join(statePath(runId), "env.json"))) throw new Error(`Test environment ${runId} already exists.`);
  if (!existsSync(join(modelDirectory, "model.onnx")))
    throw new Error("The search model is missing. Run `node apps/backend/development/download-model.mjs` first.");
  const mode = postgresMode();
  const cli = mode === "container" ? containerCli() : undefined;
  const postgresBin = mode === "native" ? nativePostgresBin() : undefined;
  const directory = statePath(runId);
  mkdirSync(join(directory, "logs"), { recursive: true, mode: 0o700 });
  const secrets = {
    admin: randomBytes(24).toString("hex"),
    migration: randomBytes(24).toString("hex"),
    runtime: randomBytes(24).toString("hex"),
  };
  const host = options.host ?? "127.0.0.1";
  const state = {
    runId,
    createdAt: new Date().toISOString(),
    postgres: mode,
    ...(mode === "container"
      ? { cli, container: `penny-test-${runId}`, image: postgresImage() }
      : { postgresBin, dataDirectory: join(directory, "pgdata"), postgresLog: join(directory, "logs/postgres.log") }),
    database: databaseName(runId),
    directory,
    receiptRoot: join(directory, "receipts"),
    apiLog: join(directory, "logs/api.log"),
    controlToken: randomBytes(32).toString("hex"),
  };
  writeState(state);
  try {
    if (options.build !== false) buildApi();
    if (!existsSync(apiDll)) throw new Error("The API is not built. Run without --no-build.");
    if (mode === "native") await startNativePostgres(state, secrets);
    else await startPostgresContainer(state, secrets);
    const connection = (user, password) =>
      `Host=127.0.0.1;Port=${state.databasePort};Database=${state.database};Username=${user};Password=${password};SSL Mode=Disable`;
    // Roles, schema and extensions (as administrator), migrations and runtime grants.
    run("bash", [join(backend, "dotnet.sh"), apiDll, "migrate", "--bootstrap", "--grant-runtime"], {
      env: {
        ...process.env,
        ConnectionStrings__Admin: connection("postgres", secrets.admin),
        ConnectionStrings__Migration: connection("penny_migrator", secrets.migration),
        ConnectionStrings__Postgres: connection("penny_runtime", secrets.runtime),
      },
    });
    const receiptKey = randomBytes(32).toString("base64");
    state.apiPort = options.port ?? await freePort(host);
    state.apiUrl = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${state.apiPort}`;
    state.origins = options.origins ?? ["http://localhost:4173", "http://127.0.0.1:4173"];
    if (options.oidc) state.oidc = { issuer: options.oidc.issuer, clientId: options.oidc.clientId, certificate: options.oidc.certificate };
    const log = openSync(state.apiLog, "a", 0o600);
    const api = spawn("bash", [join(backend, "dotnet.sh"), apiDll], {
      cwd: backend,
      detached: true,
      stdio: ["ignore", log, log],
      env: {
        ...process.env,
        ASPNETCORE_ENVIRONMENT: "Testing",
        ASPNETCORE_URLS: `http://${host}:${state.apiPort}`,
        ConnectionStrings__Postgres: connection("penny_runtime", secrets.runtime),
        Receipts__Root: state.receiptRoot,
        Receipts__MasterKey: receiptKey,
        Search__ModelDirectory: modelDirectory,
        Search__RateLimitPermits: "10000",
        Auth__RateLimitPermits: "10000",
        Auth__InviteRateLimitPermits: "10000",
        Auth__AllowedOrigins: state.origins.join(","),
        Recurrence__Worker: options.worker === false ? "false" : "true",
        // Receipt OCR (MAZ-125) needs Tesseract and poppler on the host; the full-stack
        // journeys do not depend on it, so it is off unless PENNY_OCR_WORKER=true.
        Ocr__Worker: process.env.PENNY_OCR_WORKER === "true" ? "true" : "false",
        Recurrence__PollSeconds: "2",
        TestControls__Enabled: "true",
        TestControls__Token: state.controlToken,
        Logging__LogLevel__Default: "Information",
        ...(options.oidc ? {
          Oidc__Issuer: options.oidc.issuer,
          Oidc__ClientId: options.oidc.clientId,
          Oidc__RedirectUris: options.oidc.redirectUris.join(","),
          Oidc__AllowRegistration: options.oidc.allowRegistration === false ? "false" : "true",
          TestControls__OidcCertificate: options.oidc.certificate,
        } : {}),
      },
    });
    closeSync(log);
    // An exited child stays a zombie (and answers kill(pid, 0)) until reaped, so exit
    // is tracked through the event, not by probing the pid.
    let exited = false;
    api.once("exit", () => { exited = true; });
    api.unref();
    state.apiPid = api.pid;
    writeState(state);
    await waitFor(async () => {
      if (exited) throw Object.assign(new Error("The API exited during startup; see its log"), { fatal: true });
      const response = await fetch(`${state.apiUrl}/api/ready`);
      return response.ok;
    }, { timeoutMs: 120_000, what: "the API to become ready" });
    return state;
  } catch (error) {
    error.logs = existsSync(state.apiLog) ? readFileSync(state.apiLog, "utf8").split("\n").slice(-20).join("\n") : "";
    await down(state.runId, { keepArtifacts: false });
    throw error;
  }
}

/** Container mode: the pinned image (`migrate --bootstrap` creates the roles). Sets databasePort. */
async function startPostgresContainer(state, secrets) {
  const cli = state.cli;
  // tmpfs storage: nothing outlives the container, and two runs never share a volume.
  run(cli, [
    "run", "--detach", "--name", state.container, "--label", `${label}=${state.runId}`,
    "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql",
    "--env", `POSTGRES_DB=${state.database}`, "--env", "POSTGRES_USER=postgres",
    "--env", "POSTGRES_PASSWORD",
    state.image,
  ], {
    env: { ...process.env, POSTGRES_PASSWORD: secrets.admin },
  });
  // The entrypoint's temporary init server listens on the socket only; TCP readiness
  // means initialization finished and the real server is up.
  await waitFor(() => spawnSync(cli, ["exec", state.container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", state.database]).status === 0,
    { timeoutMs: 90_000, what: "PostgreSQL" });
  const published = run(cli, ["port", state.container, "5432/tcp"]).trim().split("\n")[0];
  state.databasePort = Number(published.slice(published.lastIndexOf(":") + 1));
}

/** Stops the API, removes the container or native cluster and the run's state. Idempotent. */
export async function down(runId, { keepArtifacts } = {}) {
  const directory = statePath(runId);
  let state = {};
  try {
    state = JSON.parse(readFileSync(join(directory, "env.json"), "utf8"));
  } catch {
    // Partially created runs are still swept by label below.
  }
  if (state.apiPid && processAlive(state.apiPid)) {
    try {
      process.kill(-state.apiPid, "SIGTERM");
    } catch {
      process.kill(state.apiPid, "SIGTERM");
    }
    for (let attempt = 0; attempt < 40 && processAlive(state.apiPid); attempt++) await delay(250);
    if (processAlive(state.apiPid)) {
      try {
        process.kill(-state.apiPid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }
  // A native cluster (also one left by a crashed runner) is stopped before its files go.
  const dataDirectory = state.dataDirectory ?? join(directory, "pgdata");
  await stopNativePostgres(dataDirectory, state.postgresBin);
  let cli = state.cli;
  try {
    cli ??= containerCli();
  } catch {
    cli = undefined;
  }
  if (cli) {
    const ids = spawnSync(cli, ["ps", "--all", "--quiet", "--filter", `label=${label}=${runId}`], { encoding: "utf8" })
      .stdout?.split("\n").filter(Boolean) ?? [];
    if (ids.length) spawnSync(cli, ["rm", "--force", "--volumes", ...ids], { stdio: "ignore" });
  }
  if (!keepArtifacts) rmSync(directory, { recursive: true, force: true });
  else {
    rmSync(join(directory, "receipts"), { recursive: true, force: true });
    rmSync(dataDirectory, { recursive: true, force: true });
  }
  if (currentRunId() === runId) rmSync(join(stateRoot, "current"), { force: true });
}

/** Removes every environment, including ones whose runner crashed. */
export async function downAll() {
  const ids = new Set(existsSync(stateRoot) ? readdirSync(stateRoot).filter(validRunId) : []);
  try {
    const cli = containerCli();
    const listed = spawnSync(cli, ["ps", "--all", "--filter", `label=${label}`, "--format", `{{.Labels}}`], { encoding: "utf8" }).stdout ?? "";
    for (const match of listed.matchAll(new RegExp(`${label.replace(".", "\\.")}[=:]([a-z0-9]{4,24})`, "g"))) ids.add(match[1]);
  } catch {
    // No runtime: only state directories remain to remove.
  }
  for (const id of ids) await down(id);
  return [...ids];
}

/** Calls a test control. */
export async function control(state, method, path, body) {
  const response = await fetch(`${state.apiUrl}/api/test/${path}`, {
    method,
    headers: { [controlHeader]: state.controlToken, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const value = text ? JSON.parse(text) : undefined;
  if (!response.ok) throw new Error(`Test control ${method} ${path} failed (${response.status}): ${value?.error ?? text}`);
  return value;
}

/**
 * Copies logs and sanitized metadata into test-results/fullstack/<run id>. Secrets
 * (control token, passwords) are never written; the log never contained them.
 */
export function collectArtifacts(state, destination = join(root, "test-results/fullstack", state.runId)) {
  mkdirSync(destination, { recursive: true });
  const { controlToken: _token, ...visible } = state;
  writeFileSync(join(destination, "environment.json"), `${JSON.stringify(visible, null, 2)}\n`);
  if (existsSync(state.apiLog)) writeFileSync(join(destination, "api.log"), readFileSync(state.apiLog));
  if (state.cli && state.container) {
    const logs = spawnSync(state.cli, ["logs", state.container], { encoding: "utf8" });
    if (logs.status === 0) writeFileSync(join(destination, "postgres.log"), `${logs.stdout}${logs.stderr}`);
  } else if (state.postgresLog && existsSync(state.postgresLog)) {
    writeFileSync(join(destination, "postgres.log"), readFileSync(state.postgresLog));
  }
  return destination;
}
