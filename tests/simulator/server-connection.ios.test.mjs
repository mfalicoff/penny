import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { promisify } from "node:util";
import { createApp } from "../../server/app.ts";
import { runServerConnectionScenarios } from "./server-connection-scenarios.mjs";

const exec = promisify(execFile);
const bundleId = "com.mfalicoff.penny";
const root = resolve(import.meta.dirname, "../..");
const artifacts = resolve(root, "test-results/ios-server-connection");
const developerDir = process.env.PENNY_XCODE_DEVELOPER_DIR || "/Applications/Xcode.app/Contents/Developer";
const env = { ...process.env, DEVELOPER_DIR: developerDir };

async function command(file, args, timeout = 60000) {
  try {
    const { stdout, stderr } = await exec(file, args, { cwd: root, env, timeout, maxBuffer: 8 * 1024 * 1024 });
    return stdout + stderr;
  } catch (error) {
    throw new Error(`${file} ${args.join(" ")} failed:\n${error.stdout || ""}${error.stderr || ""}\n${error.message}`, { cause: error });
  }
}
const simctl = (...args) => command("/usr/bin/xcrun", ["simctl", ...args], 180000);

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}
async function freePort() {
  const server = createTcpServer();
  await listen(server);
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

async function installedApp() {
  const devices = JSON.parse(await simctl("list", "devices", "available", "--json"));
  const candidates = Object.entries(devices.devices).flatMap(([runtime, devices]) => devices.map((device) => ({ ...device, runtime })));
  // Reuse a development binary, not another simulator's data or JS bundle.
  for (const device of candidates.sort((a, b) => Number(b.state === "Booted") - Number(a.state === "Booted"))) {
    if (!device.runtime.includes(".iOS-")) continue;
    let app = process.env.PENNY_IOS_APP_PATH;
    if (!app) {
      try { app = (await simctl("get_app_container", device.udid, bundleId, "app")).trim(); }
      catch { continue; }
    }
    if (existsSync(app)) return { app, runtime: device.runtime, deviceType: device.deviceTypeIdentifier };
  }
  throw new Error("No Penny iOS development build found. Run npx expo run:ios first, or set PENNY_IOS_APP_PATH to a compatible simulator .app.");
}

async function waitForMetro(port, process) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    assert.equal(process.exitCode, null, "Metro exited before becoming ready; see metro.log");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/status`);
      if ((await response.text()).includes("packager-status:running")) return;
    } catch { /* Startup is asynchronous. */ }
    await delay(500);
  }
  throw new Error("Metro did not become ready within 90 seconds; see metro.log");
}

// This is deliberately separate from Jest and Playwright: every UI action goes
// through agent-device to a real iOS Simulator running the native Penny app.
test("iOS Simulator: server validation, selection and persistence", { timeout: 600000 }, async (t) => {
  assert.equal(process.platform, "darwin", "This test requires macOS, Xcode, and an installed agent-device CLI.");
  await mkdir(artifacts, { recursive: true });
  const transcript = [];
  const requests = [];
  const session = `penny-server-${process.pid}`;
  let simulator;
  let metro;
  let metroLog;
  const servers = [];
  const databases = [];

  async function device(...args) {
    const result = await command("agent-device", [...args, "--platform", "ios", "--udid", simulator, "--session", session], 120000);
    transcript.push(`$ agent-device ${args.join(" ")}\n${result}`);
    return result;
  }
  async function screenshot(name) {
    await device("screenshot", resolve(artifacts, name));
  }

  t.after(async () => {
    // Best-effort evidence and cleanup must also run after assertion failures.
    if (simulator) {
      try { transcript.push(await device("snapshot", "-i")); await screenshot("final.png"); }
      catch (error) { transcript.push(String(error)); }
      try { await device("close"); } catch (error) { transcript.push(String(error)); }
      try { await simctl("shutdown", simulator); await simctl("delete", simulator); }
      catch (error) { transcript.push(String(error)); }
    }
    if (metro && metro.exitCode === null) {
      metro.kill("SIGTERM");
      await Promise.race([once(metro, "exit"), delay(5000)]);
      if (metro.exitCode === null) metro.kill("SIGKILL");
    }
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    }
    for (const db of databases) db.close();
    metroLog?.end();
    await writeFile(resolve(artifacts, "commands.log"), transcript.join("\n\n"));
    await writeFile(resolve(artifacts, "requests.json"), JSON.stringify(requests, null, 2));
    console.log(`Simulator evidence: ${artifacts}`);
  });

  async function penny(name) {
    const { app, db } = createApp({ databasePath: ":memory:" });
    databases.push(db);
    const server = createServer((req, res) => {
      requests.push({ server: name, method: req.method, path: req.url, authorization: req.headers.authorization, cookie: req.headers.cookie });
      app(req, res);
    });
    servers.push(server);
    return listen(server);
  }
  const originalUrl = await penny("original");
  const selectedUrl = await penny("selected");
  const impostor = createServer((req, res) => {
    requests.push({ server: "impostor", path: req.url, authorization: req.headers.authorization, cookie: req.headers.cookie });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ name: "not-penny", version: "99.0.0" }));
  });
  servers.push(impostor);
  const impostorUrl = await listen(impostor);
  const version = (await (await fetch(`${selectedUrl}/api/info`)).json()).version;
  requests.length = 0;

  const source = await installedApp();
  simulator = (await simctl("create", `Penny server test ${process.pid}`, source.deviceType, source.runtime)).trim();
  console.log(`Temporary simulator: ${simulator} (${source.runtime}); source app: ${source.app}`);
  await simctl("boot", simulator);
  await simctl("bootstatus", simulator, "-b");
  await simctl("install", simulator, source.app);

  const port = await freePort();
  metroLog = createWriteStream(resolve(artifacts, "metro.log"));
  // Keep Expo's localhost listener consistent with explicit IPv4 debug URLs.
  metro = spawn(process.execPath, ["--dns-result-order=ipv4first", "node_modules/expo/bin/cli", "start", "--localhost", "--port", String(port)], {
    cwd: root,
    env: { ...env, CI: "1", EXPO_NO_DOTENV: "1", EXPO_NO_TELEMETRY: "1", EXPO_PUBLIC_API_URL: originalUrl },
    stdio: ["ignore", "pipe", "pipe"],
  });
  metro.stdout.pipe(metroLog);
  metro.stderr.pipe(metroLog);
  await waitForMetro(port, metro);
  // NSArgumentDomain also binds the debug host inside the app sandbox. On newer
  // iOS runtimes, simulator-wide defaults alone may not reach sandboxed apps.
  const open = () => device("open", bundleId, "--relaunch", "--foreground", "--metro-host", "127.0.0.1", "--metro-port", String(port),
    "--launch-args=-RCT_jsLocation", `--launch-args=127.0.0.1:${port}`,
    "--launch-args=-RCT_packager_scheme", "--launch-args=http");
  await runServerConnectionScenarios(t, { device, open, requests, originalUrl, selectedUrl, impostorUrl, version, artifacts });
});
