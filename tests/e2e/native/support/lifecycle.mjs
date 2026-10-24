import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { constants, createWriteStream, existsSync } from "node:fs";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { delimiter, isAbsolute, resolve } from "node:path";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

export const root = resolve(import.meta.dirname, "../../../..");
export const bundleId = "com.mfalicoff.penny";
const exec = promisify(execFile);

export async function command(file, args, timeout = 60000, env = process.env) {
  try {
    const { stdout, stderr } = await exec(file, args, { cwd: root, env, timeout, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024 });
    return stdout + stderr;
  } catch (error) {
    throw new Error(`${file} ${args.join(" ")} failed:\n${error.stdout || ""}${error.stderr || ""}\n${error.message}`, { cause: error });
  }
}

export async function requireExecutable(file, message, env = process.env) {
  const candidates = isAbsolute(file) || file.includes("/") || file.includes("\\")
    ? [resolve(root, file)]
    : (env.PATH || "").split(delimiter).flatMap((directory) => process.platform === "win32"
      ? (env.PATHEXT || ".EXE;.CMD;.BAT").split(";").map((extension) => resolve(directory, `${file}${extension.toLowerCase()}`))
      : [resolve(directory, file)]);
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* Try the next PATH entry. */ }
  }
  throw new Error(message);
}

export async function commonPreflight() {
  assert.ok(Number(process.versions.node.split(".")[0]) >= 24, "Native E2E requires Node.js 24 or newer.");
  await requireExecutable("agent-device", "agent-device is not on PATH. Install it separately with npm install -g agent-device@latest, then rerun this command. The runner never downloads tools.");
  assert.ok(existsSync(resolve(root, "node_modules/expo/bin/cli")), "The checkout's Expo CLI is missing. Run npm ci first.");
}

export async function listen(server, port = 0) {
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

export async function freePort(port = 0) {
  const server = createServer();
  await listen(server, port);
  const available = server.address().port;
  await new Promise((done) => server.close(done));
  return available;
}

export async function waitUntil(check, child, description, timeout = 180000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, `${description} process exited; inspect its artifact log`);
    assert.equal(child.signalCode, null, `${description} process was killed; inspect its artifact log`);
    assert.ifError(child.spawnError);
    try { if (await check()) return; } catch (error) { lastError = error; }
    await delay(500);
  }
  throw new Error(`${description} did not become ready within ${timeout / 1000} seconds: ${lastError || "readiness condition was not met"}`);
}

export async function stop(child) {
  if (!child) return;
  if (child.pid && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await Promise.race([exited, delay(5000)]);
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
  }
  // `exit` can precede the last stdout/stderr bytes; drain them before ending logs.
  await child.outputClosed;
}

/** Journey-independent ownership of evidence, child processes and device sessions. */
export async function createNativeHarness(t, platform, journey, env = process.env) {
  const artifacts = resolve(root, "test-results/native", platform, journey);
  await mkdir(artifacts, { recursive: true });
  // Each run owns its daemon; never inherit another session's toolchain state.
  const automationDir = await mkdtemp(resolve(artifacts, "agent-device-"));
  env = { ...env, AGENT_DEVICE_STATE_DIR: automationDir };
  const transcript = [];
  const cleanups = [];
  const streams = [];
  const session = `penny-${platform}-${journey}-${process.pid}`;
  let target;
  let opened = false;
  let automationUsed = false;
  let cleanupPromise;
  const persist = () => writeFile(resolve(artifacts, "commands.log"), transcript.join("\n\n"));
  const addCleanup = (cleanup) => cleanups.push(cleanup);

  async function device(...args) {
    // Android RN accessibility-idle settling can stall; the journey waits for
    // explicit destination text instead. Keep this platform behavior reusable.
    if (platform === "android") args = args.filter((arg) => arg !== "--settle");
    const line = `$ agent-device ${args.join(" ")}`;
    // A failed open can still create a session; attempt to close it at teardown.
    if (args[0] === "open") opened = true;
    try {
      automationUsed = true;
      const result = await command("agent-device", [...args, "--platform", platform, ...target, "--session", session], 120000, env);
      transcript.push(`${line}\n${result}`);
      if (args[0] === "close") opened = false;
      if (platform === "android" && args[0] === "fill") await device("keyboard", "dismiss");
      return result;
    } catch (error) {
      transcript.push(`${line}\n${error}`);
      throw error;
    } finally { await persist(); }
  }

  async function cleanup() {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      const errors = [];
      if (opened) {
        try { await device("snapshot", "-i"); await device("screenshot", resolve(artifacts, "final.png")); }
        catch (error) { transcript.push(String(error)); }
        try { await device("close"); } catch (error) { transcript.push(String(error)); }
      }
      if (automationUsed) {
        try { await command("agent-device", ["daemon", "stop", "--state-dir", automationDir, "--clean"], 120000, env); }
        catch (error) { errors.push(error); transcript.push(String(error)); }
      }
      for (const dispose of cleanups.toReversed()) {
        try { await dispose(); } catch (error) { errors.push(error); transcript.push(String(error)); }
      }
      for (const stream of streams) {
        const finished = once(stream, "finish");
        stream.end();
        await finished;
      }
      await persist();
      console.log(`Native ${platform} evidence: ${artifacts}`);
      if (errors.length) throw new AggregateError(errors, "Native teardown failed; see commands.log");
    })();
    return cleanupPromise;
  }
  const interrupt = (signal) => {
    void cleanup().catch((error) => console.error(error)).finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
  };
  const onInterrupt = () => interrupt("SIGINT");
  const onTerminate = () => interrupt("SIGTERM");
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);
  t.after(async () => {
    try { await cleanup(); }
    finally { process.off("SIGINT", onInterrupt); process.off("SIGTERM", onTerminate); }
  });

  function launch(file, args, filename, childEnv = env) {
    const child = spawn(file, args, { cwd: root, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
    child.outputClosed = new Promise((done) => child.once("close", done));
    child.on("error", (error) => { child.spawnError = error; transcript.push(`${file}: ${error}`); });
    const stream = createWriteStream(resolve(artifacts, filename));
    streams.push(stream);
    child.stdout.pipe(stream, { end: false });
    child.stderr.pipe(stream, { end: false });
    addCleanup(() => stop(child));
    return child;
  }

  async function startMetro(originalUrl) {
    const port = await freePort();
    const child = launch(process.execPath, ["--dns-result-order=ipv4first", "node_modules/expo/bin/cli", "start", "--localhost", "--port", String(port)], "metro.log", {
      ...env, CI: "1", EXPO_NO_DOTENV: "1", EXPO_NO_TELEMETRY: "1", EXPO_PUBLIC_API_URL: originalUrl,
    });
    await waitUntil(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(3000) });
      const status = await response.text();
      if (!response.ok || !status.includes("packager-status:running")) throw new Error(`Metro status ${response.status}: ${status.slice(0, 200)}`);
      return true;
    }, child, "Metro", 90000);
    return port;
  }
  return { artifacts, device, addCleanup, launch, startMetro, setTarget: (args) => { target = args; } };
}
