import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { promisify } from "node:util";
import { createApp } from "../../server/app.ts";
import { runServerConnectionScenarios } from "./server-connection-scenarios.mjs";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");
const artifacts = resolve(root, "test-results/android-server-connection");
const bundleId = "com.mfalicoff.penny";
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(homedir(), process.platform === "darwin" ? "Library/Android/sdk" : "Android/Sdk");
const emulatorBinary = join(sdk, "emulator", process.platform === "win32" ? "emulator.exe" : "emulator");
const adbBinary = process.env.PENNY_ADB_PATH || "adb";

async function command(file, args, timeout = 60000, env = process.env) {
  try {
    const { stdout, stderr } = await exec(file, args, { cwd: root, env, timeout, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024 });
    return stdout + stderr;
  } catch (error) {
    throw new Error(`${file} ${args.join(" ")} failed:\n${error.stdout || ""}${error.stderr || ""}\n${error.message}`, { cause: error });
  }
}
async function listen(server, port = 0) {
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}
async function freePort(port = 0) {
  const server = createTcpServer();
  await listen(server, port);
  const available = server.address().port;
  await new Promise((done) => server.close(done));
  return available;
}
async function emulatorPort() {
  // Stay in adb's default emulator discovery range.
  for (let port = 5560; port < 5584; port += 2) {
    try { await freePort(port); await freePort(port + 1); return port; }
    catch { /* Both the emulator console and adb ports must be available. */ }
  }
  throw new Error("No free emulator console/adb port pair was found.");
}
async function sourceAvd() {
  const avdHome = process.env.ANDROID_AVD_HOME || join(process.env.ANDROID_USER_HOME || join(homedir(), ".android"), "avd");
  const names = (await readdir(avdHome)).filter((name) => name.endsWith(".ini"));
  const selected = process.env.PENNY_ANDROID_AVD;
  const name = selected ? `${selected}.ini` : names[0];
  assert.ok(name && names.includes(name), "No source AVD found. Create one with Android Device Manager or set PENNY_ANDROID_AVD.");
  const ini = await readFile(join(avdHome, name), "utf8");
  const path = ini.match(/^path=(.+)$/m)?.[1].trim();
  assert.ok(path, `No path found in ${name}`);
  const config = await readFile(join(path, "config.ini"), "utf8");
  return { name: name.slice(0, -4), config };
}
async function waitUntil(check, process, description, timeout = 180000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    assert.equal(process.exitCode, null, `${description} process exited; inspect its artifact log`);
    try { if (await check()) return; } catch (error) { lastError = error; }
    await delay(500);
  }
  throw new Error(`${description} did not become ready within ${timeout / 1000} seconds: ${lastError || "readiness condition was not met"}`);
}

// A new AVD is created from configuration only: no existing app data, userdata
// image, sdcard or snapshots are copied or wiped on the source emulator.
test("Android Emulator: server validation, selection and persistence", { timeout: 600000 }, async (t) => {
  assert.ok(existsSync(emulatorBinary), "Android Emulator not found. Set ANDROID_HOME to the installed SDK.");
  const apk = resolve(process.env.PENNY_ANDROID_APK || join(root, "android/app/build/outputs/apk/debug/app-debug.apk"));
  assert.ok(existsSync(apk), "No Android development APK found. Run npx expo run:android or set PENNY_ANDROID_APK.");
  await mkdir(artifacts, { recursive: true });
  const transcript = [];
  const requests = [];
  const session = `penny-android-server-${process.pid}`;
  const servers = [];
  const databases = [];
  const logStreams = [];
  let temporary;
  let emulator;
  let serial;
  let metro;
  let opened = false;
  const adb = (...args) => command(adbBinary, ["-s", serial, ...args]);
  async function device(...args) {
    // Android's accessibility-idle settle loop can stall on RN content. Use
    // explicit destination waits in the shared flow instead of post-action idle.
    args = args.filter((arg) => arg !== "--settle");
    const line = `$ agent-device ${args.join(" ")}`;
    try {
      const result = await command("agent-device", [...args, "--platform", "android", "--serial", serial, "--session", session], 120000);
      transcript.push(`${line}\n${result}`);
      if (args[0] === "open") opened = true;
      if (args[0] === "close") opened = false;
      if (args[0] === "fill") await device("keyboard", "dismiss");
      return result;
    } catch (error) {
      transcript.push(`${line}\n${error}`);
      throw error;
    } finally {
      await writeFile(resolve(artifacts, "commands.log"), transcript.join("\n\n"));
    }
  }
  function logProcess(child, filename) {
    const stream = createWriteStream(resolve(artifacts, filename));
    logStreams.push(stream);
    child.stdout.pipe(stream);
    child.stderr.pipe(stream);
  }
  async function stop(child) {
    if (!child || child.exitCode !== null) return;
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), delay(5000)]);
    if (child.exitCode === null) { child.kill("SIGKILL"); await once(child, "exit"); }
  }
  t.after(async () => {
    if (opened) {
      try { await device("snapshot", "-i"); await device("screenshot", resolve(artifacts, "final.png")); }
      catch (error) { transcript.push(String(error)); }
      try { await device("close"); } catch (error) { transcript.push(String(error)); }
    }
    if (emulator && emulator.exitCode === null) {
      try { await adb("emu", "kill"); } catch { /* SIGTERM below is the fallback. */ }
    }
    await stop(emulator);
    await stop(metro);
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    }
    for (const db of databases) db.close();
    for (const stream of logStreams) stream.end();
    if (temporary) await rm(temporary, { recursive: true, force: true });
    await writeFile(resolve(artifacts, "commands.log"), transcript.join("\n\n"));
    await writeFile(resolve(artifacts, "requests.json"), JSON.stringify(requests, null, 2));
    console.log(`Android emulator evidence: ${artifacts}`);
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

  const source = await sourceAvd();
  temporary = await mkdtemp(join(tmpdir(), "penny-android-server-"));
  const avdName = `PennyServerTest_${process.pid}`;
  const avdHome = join(temporary, "avd");
  const avdPath = join(avdHome, `${avdName}.avd`);
  await mkdir(avdPath, { recursive: true });
  const target = source.config.match(/^target=(.+)$/m)?.[1].trim();
  assert.ok(target, "The source AVD has no Android target");
  const config = source.config.replace(/^AvdId=.*$/m, `AvdId=${avdName}`)
    .replace(/^avd.ini.displayname=.*$/m, "avd.ini.displayname=Penny server regression test")
    .replace(/^fastboot.forceColdBoot=.*$/m, "fastboot.forceColdBoot=yes")
    .replace(/^fastboot.forceFastBoot=.*$/m, "fastboot.forceFastBoot=no")
    .replace(/^(?:sdcard\.path|disk\.(?:dataPartition|cachePartition|encryptionKeyPartition)\.path)=.*\n?/gm, "");
  await writeFile(join(avdPath, "config.ini"), config);
  await writeFile(join(avdHome, `${avdName}.ini`), `avd.ini.encoding=UTF-8\npath=${avdPath}\ntarget=${target}\n`);
  const port = await emulatorPort();
  serial = `emulator-${port}`;
  emulator = spawn(emulatorBinary, ["-avd", avdName, "-port", String(port), "-no-window", "-no-snapshot", "-no-audio", "-no-boot-anim", "-camera-back", "none", "-camera-front", "none"], {
    env: { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, ANDROID_AVD_HOME: avdHome },
    stdio: ["ignore", "pipe", "pipe"],
  });
  logProcess(emulator, "emulator.log");
  console.log(`Temporary Android emulator: ${serial}; source configuration: ${source.name} (${target}); APK: ${apk}`);
  await waitUntil(async () => (await adb("shell", "getprop", "sys.boot_completed")).trim() === "1", emulator, "Android Emulator");
  await adb("shell", "input", "keyevent", "KEYCODE_WAKEUP");
  await adb("shell", "wm", "dismiss-keyguard");
  await device("install", bundleId, apk);

  const metroPort = await freePort();
  // Expo binds the name "localhost". Prefer IPv4 so adb reverse and the
  // explicit 127.0.0.1 readiness/debug URLs can reach that loopback listener.
  metro = spawn(process.execPath, ["--dns-result-order=ipv4first", "node_modules/expo/bin/cli", "start", "--localhost", "--port", String(metroPort)], {
    cwd: root,
    env: { ...process.env, CI: "1", EXPO_NO_DOTENV: "1", EXPO_NO_TELEMETRY: "1", EXPO_PUBLIC_API_URL: originalUrl },
    stdio: ["ignore", "pipe", "pipe"],
  });
  logProcess(metro, "metro.log");
  await waitUntil(async () => {
    const response = await fetch(`http://127.0.0.1:${metroPort}/status`, { signal: AbortSignal.timeout(3000) });
    const status = await response.text();
    if (!response.ok || !status.includes("packager-status:running")) throw new Error(`Metro status ${response.status}: ${status.slice(0, 200)}`);
    return true;
  }, metro, "Metro", 90000);
  for (const port of [metroPort, ...[originalUrl, selectedUrl, impostorUrl].map((url) => new URL(url).port)]) {
    await adb("reverse", `tcp:${port}`, `tcp:${port}`);
  }
  const open = () => device("open", bundleId, "--relaunch", "--foreground", "--no-test-ime", "--metro-host", "127.0.0.1", "--metro-port", String(metroPort));
  // The Pixel profile's modal already exposes the server and Leave demo button;
  // avoid scrolling its separate Android dialog window unnecessarily.
  await runServerConnectionScenarios(t, { device, open, requests, originalUrl, selectedUrl, impostorUrl, version, artifacts, settingsNeedsScroll: false });
});
