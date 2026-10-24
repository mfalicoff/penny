import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { bundleId, command, freePort, requireExecutable, root, waitUntil } from "./lifecycle.mjs";

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(homedir(), process.platform === "darwin" ? "Library/Android/sdk" : "Android/Sdk");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const emulatorBinary = join(sdk, "emulator", `emulator${executableSuffix}`);
const sdkAdb = join(sdk, "platform-tools", `adb${executableSuffix}`);
const adbBinary = process.env.PENNY_ADB_PATH || (existsSync(sdkAdb) ? sdkAdb : "adb");
export const androidEnv = { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, PATH: `${join(sdk, "platform-tools")}${delimiter}${process.env.PATH || ""}` };
const value = (config, key) => config.split(/\r?\n/).find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1).trim();

export async function preflight() {
  assert.ok(existsSync(sdk), `Android SDK not found at ${sdk}. Install the SDK with Android Studio and set ANDROID_HOME or ANDROID_SDK_ROOT.`);
  await requireExecutable(emulatorBinary, `Android Emulator not found at ${emulatorBinary}. Install Android Emulator in Android Studio's SDK Manager.`);
  await requireExecutable(adbBinary, "adb is unavailable. Install SDK Platform-Tools, expose adb on PATH, or set PENNY_ADB_PATH.", androidEnv);
  await command(adbBinary, ["version"], 60000, androidEnv);
  const apk = resolve(process.env.PENNY_ANDROID_APK || join(root, "android/app/build/outputs/apk/debug/app-debug.apk"));
  assert.ok(existsSync(apk), `No Android development APK at ${apk}. Run npx expo run:android or set PENNY_ANDROID_APK.`);
  const avdHome = process.env.ANDROID_AVD_HOME || join(process.env.ANDROID_USER_HOME || join(homedir(), ".android"), "avd");
  let names;
  try { names = (await readdir(avdHome)).filter((name) => name.endsWith(".ini")).sort(); }
  catch (error) { throw new Error(`Cannot read AVD profiles at ${avdHome}. Create an AVD with Android Device Manager or set ANDROID_AVD_HOME.`, { cause: error }); }
  const selected = process.env.PENNY_ANDROID_AVD;
  const name = selected ? `${selected}.ini` : names[0];
  assert.ok(name && names.includes(name), "No matching source AVD found. Create one with Android Device Manager or set PENNY_ANDROID_AVD to its name.");
  const ini = await readFile(join(avdHome, name), "utf8");
  const sourcePath = value(ini, "path");
  assert.ok(sourcePath, `No path found in ${join(avdHome, name)}. Repair the source AVD in Android Device Manager.`);
  const config = await readFile(join(sourcePath, "config.ini"), "utf8");
  const target = value(config, "target");
  assert.ok(target, `The source AVD ${name} has no Android target. Repair it in Android Device Manager.`);
  const image = value(config, "image.sysdir.1");
  assert.ok(image, `The source AVD ${name} has no system image. Install/select one in Android Device Manager.`);
  const imagePath = isAbsolute(image) ? image : resolve(sdk, image);
  assert.ok(existsSync(join(imagePath, "system.img")), `Android system image not found at ${imagePath}. Install the source AVD's system image with SDK Manager; the runner never downloads it.`);
  return { name: name.slice(0, -4), config, target, imagePath, apk };
}

async function emulatorPort() {
  // Stay in adb's default emulator discovery range.
  for (let port = 5560; port < 5584; port += 2) {
    try { await freePort(port); await freePort(port + 1); return port; }
    catch { /* Both the emulator console and adb ports must be available. */ }
  }
  throw new Error("No free emulator console/adb port pair was found.");
}

export async function start(harness, source) {
  let temporary;
  let emulator;
  let serial;
  const adb = (...args) => command(adbBinary, ["-s", serial, ...args], 60000, androidEnv);
  harness.addCleanup(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); });
  temporary = await mkdtemp(join(tmpdir(), "penny-android-server-"));
  const avdName = `PennyServerTest_${process.pid}`;
  const avdHome = join(temporary, "avd");
  const avdPath = join(avdHome, `${avdName}.avd`);
  await mkdir(avdPath, { recursive: true });
  // Copy configuration only, never userdata, sdcard or snapshots. Remove all
  // writable image paths so no setting can point back into the source AVD.
  const config = source.config.split(/\r?\n/).filter((line) => !/^(?:AvdId|avd\.ini\.displayname|fastboot\.[^=]+|snapshot\.[^=]+|sdcard\.path|disk\.[^=]+\.(?:path|initPath)|image\.sysdir\.1)=/.test(line)).join("\n")
    + `\nAvdId=${avdName}\navd.ini.displayname=Penny server regression test\nfastboot.forceColdBoot=yes\nfastboot.forceFastBoot=no\nimage.sysdir.1=${source.imagePath}\n`;
  await writeFile(join(avdPath, "config.ini"), config);
  await writeFile(join(avdHome, `${avdName}.ini`), `avd.ini.encoding=UTF-8\npath=${avdPath}\ntarget=${source.target}\n`);
  const port = await emulatorPort();
  serial = `emulator-${port}`;
  harness.setTarget(["--serial", serial]);
  emulator = harness.launch(emulatorBinary, ["-avd", avdName, "-port", String(port), "-no-window", "-no-snapshot", "-no-audio", "-no-boot-anim", "-camera-back", "none", "-camera-front", "none"], "emulator.log", { ...androidEnv, ANDROID_AVD_HOME: avdHome });
  harness.addCleanup(async () => {
    if (emulator.exitCode === null && emulator.signalCode === null) {
      try { await adb("emu", "kill"); } catch { /* Process termination is the next cleanup fallback. */ }
    }
  });
  console.log(`Temporary Android emulator: ${serial}; source configuration: ${source.name} (${source.target}); APK: ${source.apk}`);
  await waitUntil(async () => (await adb("shell", "getprop", "sys.boot_completed")).trim() === "1", emulator, "Android Emulator");
  await adb("shell", "input", "keyevent", "KEYCODE_WAKEUP");
  await adb("shell", "wm", "dismiss-keyguard");
  await harness.device("install", bundleId, source.apk);
  return {
    async connect(port, urls) {
      for (const forwarded of [port, ...urls.map((url) => new URL(url).port)]) await adb("reverse", `tcp:${forwarded}`, `tcp:${forwarded}`);
    },
    open: (port) => harness.device("open", bundleId, "--relaunch", "--foreground", "--no-test-ime", "--metro-host", "127.0.0.1", "--metro-port", String(port)),
    // The Pixel profile's modal exposes the server and Leave demo button;
    // don't scroll its separate Android dialog window unnecessarily.
    settingsNeedsScroll: false,
  };
}
