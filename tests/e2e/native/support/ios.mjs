import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { bundleId, command } from "./lifecycle.mjs";

export const iosEnv = {
  ...process.env,
  // Nix may export an SDK-only DEVELOPER_DIR; simulator tools need full Xcode.
  DEVELOPER_DIR: process.env.PENNY_XCODE_DEVELOPER_DIR || "/Applications/Xcode.app/Contents/Developer",
  PATH: `${resolve(process.env.PENNY_XCODE_DEVELOPER_DIR || "/Applications/Xcode.app/Contents/Developer", "usr/bin")}:/usr/bin:${process.env.PATH || ""}`,
};
const simctl = (...args) => command("/usr/bin/xcrun", ["simctl", ...args], 180000, iosEnv);

export async function preflight() {
  assert.equal(process.platform, "darwin", "iOS E2E requires macOS with Xcode and an installed iOS Simulator runtime. Use a macOS host; all never skips iOS.");
  assert.ok(existsSync(resolve(iosEnv.DEVELOPER_DIR, "usr/bin/xcodebuild")), "Full Xcode was not found. Install/open Xcode, accept its license, and set PENNY_XCODE_DEVELOPER_DIR to Xcode.app/Contents/Developer if needed.");
  const [{ runtimes }, { devicetypes }, { devices }] = await Promise.all([
    simctl("list", "runtimes", "--json").then(JSON.parse),
    simctl("list", "devicetypes", "--json").then(JSON.parse),
    simctl("list", "devices", "available", "--json").then(JSON.parse),
  ]);
  const runtimeOverride = process.env.PENNY_IOS_RUNTIME;
  const typeOverride = process.env.PENNY_IOS_DEVICE_TYPE;
  const availableRuntimes = runtimes.filter((runtime) => runtime.isAvailable && runtime.identifier.includes(".iOS-")
    && (!runtimeOverride || runtime.identifier === runtimeOverride || runtime.name === runtimeOverride))
    .sort((a, b) => a.identifier.localeCompare(b.identifier));
  assert.ok(availableRuntimes.length, "No matching available iOS runtime. Install one in Xcode Settings > Components, or correct PENNY_IOS_RUNTIME (runtime identifier or exact name).");
  const types = devicetypes.filter((type) => type.productFamily === "iPhone" || type.identifier.includes(".iPhone-"))
    .filter((type) => !typeOverride || type.identifier === typeOverride || type.name === typeOverride)
    .sort((a, b) => a.identifier.localeCompare(b.identifier));
  assert.ok(types.length, "No matching iPhone simulator device type. Correct PENNY_IOS_DEVICE_TYPE (identifier or exact name).");
  const compatibleType = (runtime) => types.find((type) => {
    const version = runtime.version.split(".").map(Number);
    const packed = version[0] * 65536 + (version[1] || 0) * 256 + (version[2] || 0);
    return (type.minRuntimeVersion === undefined || type.minRuntimeVersion <= packed)
      && (type.maxRuntimeVersion === undefined || type.maxRuntimeVersion >= packed);
  });
  async function validateApp(app) {
    assert.ok(existsSync(resolve(app, "Info.plist")), `Penny simulator .app not found at ${app}. Run npx expo run:ios first or set PENNY_IOS_APP_PATH.`);
    const id = (await command("/usr/bin/plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", resolve(app, "Info.plist")], 60000, iosEnv)).trim();
    assert.equal(id, bundleId, `The simulator app must have bundle identifier ${bundleId}; found ${id}.`);
    const platforms = JSON.parse(await command("/usr/bin/plutil", ["-extract", "CFBundleSupportedPlatforms", "json", "-o", "-", resolve(app, "Info.plist")], 60000, iosEnv));
    assert.ok(platforms.includes("iPhoneSimulator"), "PENNY_IOS_APP_PATH must point to a simulator .app, not a device/archive build. Build with npx expo run:ios.");
    return app;
  }
  if (process.env.PENNY_IOS_APP_PATH) {
    for (const runtime of availableRuntimes) {
      const type = compatibleType(runtime);
      if (type) return { app: await validateApp(resolve(process.env.PENNY_IOS_APP_PATH)), runtime: runtime.identifier, deviceType: type.identifier };
    }
    throw new Error("No compatible iPhone device type/runtime pair. Correct PENNY_IOS_DEVICE_TYPE and PENNY_IOS_RUNTIME.");
  }
  const candidates = Object.entries(devices).flatMap(([runtime, entries]) => entries.map((device) => ({ ...device, runtime })))
    .filter((device) => availableRuntimes.some((runtime) => runtime.identifier === device.runtime)
      && types.some((type) => type.identifier === device.deviceTypeIdentifier))
    .sort((a, b) => Number(b.state === "Booted") - Number(a.state === "Booted")
      || a.runtime.localeCompare(b.runtime) || a.udid.localeCompare(b.udid));
  for (const device of candidates) {
    let app;
    try { app = (await simctl("get_app_container", device.udid, bundleId, "app")).trim(); }
    catch { continue; }
    if (existsSync(app)) return { app: await validateApp(app), runtime: device.runtime, deviceType: device.deviceTypeIdentifier };
  }
  throw new Error("No Penny iOS development build found on a matching simulator. Run npx expo run:ios first, or set PENNY_IOS_APP_PATH to a compatible simulator .app. Optional PENNY_IOS_RUNTIME and PENNY_IOS_DEVICE_TYPE select its profile.");
}

export async function start(harness, source) {
  let simulator;
  harness.addCleanup(async () => {
    if (!simulator) return;
    // Delete even if shutdown fails (for example when boot never completed).
    try { await simctl("shutdown", simulator); }
    finally { await simctl("delete", simulator); }
  });
  simulator = (await simctl("create", `Penny server test ${process.pid}`, source.deviceType, source.runtime)).trim();
  harness.setTarget(["--udid", simulator]);
  console.log(`Temporary simulator: ${simulator} (${source.runtime}); source app: ${source.app}`);
  await simctl("boot", simulator);
  await simctl("bootstatus", simulator, "-b");
  await simctl("install", simulator, source.app);
  return {
    open: (port) => harness.device("open", bundleId, "--relaunch", "--foreground", "--metro-host", "127.0.0.1", "--metro-port", String(port),
      // NSArgumentDomain binds the debug host inside the app sandbox, where
      // simulator-wide defaults may not reach newer iOS runtimes.
      "--launch-args=-RCT_jsLocation", `--launch-args=127.0.0.1:${port}`,
      "--launch-args=-RCT_packager_scheme", "--launch-args=http"),
  };
}
