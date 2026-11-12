import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import * as ios from "../tests/e2e/native/support/ios.mjs";
import { commonPreflight, root } from "../tests/e2e/native/support/lifecycle.mjs";

const usage = "Usage: node scripts/run-native-tests.mjs [--check] ios\n--check only discovers prerequisites; it never boots devices, starts Metro, builds apps or downloads tools.";
const args = process.argv.slice(2);
const platforms = args.filter((arg) => arg !== "--check");
if (platforms.length !== 1 || platforms[0] !== "ios" || args.filter((arg) => arg === "--check").length > 1) {
  console.error(usage);
  process.exit(2);
}
// Android is retired (MAZ-98); the legacy Expo journeys run on iOS only.
const selected = platforms;
const adapters = { ios };
let child;
let interrupted;
const forward = (signal) => {
  interrupted = signal;
  // --test-isolation=none keeps the device-owning harness in this child, so
  // forwarding reaches its signal handler and waits for teardown before exit.
  child?.kill(signal);
};
const onInterrupt = () => forward("SIGINT");
const onTerminate = () => forward("SIGTERM");
process.on("SIGINT", onInterrupt);
process.on("SIGTERM", onTerminate);

try {
  await commonPreflight();
  const directory = resolve(root, "tests/e2e/native");
  const entries = await readdir(directory);
  const files = {};
  const failures = [];
  // Check every requested platform before allocating any device or backend.
  for (const platform of selected) {
    if (interrupted) break;
    try {
      const source = await adapters[platform].preflight();
      files[platform] = entries.filter((name) => name.endsWith(`.${platform}.test.mjs`)).sort().map((name) => resolve(directory, name));
      if (!files[platform].length) throw new Error(`No ${platform} native journeys found in ${directory}.`);
      console.log(`iOS prerequisites ready: ${source.runtime}; ${source.deviceType}; app ${source.app}`);
    } catch (error) { failures.push(`${platform}: ${error.message}`); }
  }
  if (failures.length) throw new Error(`Native prerequisites are missing:\n${failures.join("\n")}`);
  if (!args.includes("--check") && !interrupted) {
    for (const platform of selected) {
      const status = await new Promise((done, reject) => {
        child = spawn(process.execPath, ["--experimental-strip-types", "--test", "--test-isolation=none", ...files[platform]], { cwd: root, env: process.env, stdio: "inherit" });
        child.once("error", reject);
        child.once("exit", (code, signal) => done(code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1)));
      });
      child = undefined;
      if (status !== 0) { process.exitCode = status; break; }
      if (interrupted) break;
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  process.off("SIGINT", onInterrupt);
  process.off("SIGTERM", onTerminate);
  if (interrupted) process.exitCode = interrupted === "SIGINT" ? 130 : 143;
}
