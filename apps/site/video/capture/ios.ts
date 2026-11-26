// Records the iOS clips (Overview, Entries) from the iOS demo on the simulator. Mac only.
//
//   node capture/ios.ts [--reuse]     (--reuse: cut the clips from the last run's recordings again)
//
// Needs Xcode (apps/ios/AGENTS.md) and ffmpeg (FFMPEG overrides the one on PATH). No server: the
// demo's sample data is synthetic and pinned to the UI tests' date.
//
// How it works:
//   1. ios/ClipCaptureTests.swift is copied into apps/ios/PennyUITests/Clips for this run only
//      (removed when the script ends), and `apps/ios/scripts/ios.sh ui-test full` runs it on its
//      own throwaway iPhone simulator.
//   2. Each test sets up its screen, then writes ready-<clip> into captures/ios-run. This script
//      cleans the status bar, records the screen with `simctl io recordVideo` into <clip>.mov and
//      writes recording-<clip> (the wall-clock time it started). The test then drives the demo
//      and writes <clip>.json: the time of each step and its element's frame, in points.
//   3. Each clip's stretch of its recording becomes frames at 2× and 60 fps, plus capture.json,
//      in the format the web capture writes (see ../src/capture.ts), in captures/<clip>/.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Capture } from "../src/capture.ts";

const CLIPS = ["overview", "entries"] as const;
/** Frames per second taken from the recording: compositions may play a stretch faster. */
const FPS = 60;
const SCALE = 2;

const here = import.meta.dirname;
const root = resolve(here, "../../../..");
const ios = join(root, "apps/ios");
const captures = resolve(here, "../captures");
const run = join(captures, "ios-run");
const testDir = join(ios, "PennyUITests/Clips");
const testFile = join(testDir, "ClipCaptureTests.swift");
const ffmpeg = process.env.FFMPEG ?? "ffmpeg";

/** The environment Xcode's tools need: no Nix SDK or compiler variables (as ios.sh does). */
function xcodeEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const dropped = new Set(["SDKROOT", "DEVELOPER_DIR", "MACOSX_DEPLOYMENT_TARGET", "CC", "CXX", "LD"]);
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) if (!name.startsWith("NIX_") && !dropped.has(name)) env[name] = value;
  return { ...env, PATH: `/usr/bin:/bin:/usr/sbin:/sbin:${process.env.PATH ?? ""}`, ...extra };
}

function simctl(...args: string[]): string {
  return execFileSync("/usr/bin/xcrun", ["simctl", ...args], { env: xcodeEnv(), encoding: "utf8" });
}

/** ios.sh names its devices "penny-run <type> <pid> <checkout tag>" (checkout_tag in ios.sh). */
const tag = createHash("sha1").update(root).digest("hex").slice(0, 8);

function bootedRunDevice(): string | undefined {
  const list = JSON.parse(simctl("list", "devices", "booted", "-j")) as { devices: Record<string, { udid: string; name: string }[]> };
  return Object.values(list.devices)
    .flat()
    .find((device) => device.name.startsWith("penny-run iPhone") && device.name.endsWith(` ${tag}`))?.udid;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/**
 * Records the simulator's screen until `stop()` holds. Resolves once the recording has started,
 * with that wall-clock time and a promise for the finished file.
 */
async function recordScreen(device: string, movie: string, log: string, stop: () => boolean): Promise<{ started: number; finished: Promise<void> }> {
  const recorder = spawn("/usr/bin/xcrun", ["simctl", "io", device, "recordVideo", "--codec=h264", "--force", movie], {
    env: xcodeEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let started = 0;
  const onOutput = (chunk: Buffer) => {
    output += chunk.toString();
    if (started === 0 && output.includes("Recording started")) started = Date.now() / 1000;
  };
  recorder.stdout.on("data", onOutput);
  recorder.stderr.on("data", onOutput);
  let running = true;
  const exited = new Promise<void>((done) => recorder.on("exit", () => ((running = false), done())));
  while (started === 0 && running) await sleep(20);
  if (started === 0) throw new Error(`The screen recording didn't start:\n${output}`);
  return {
    started,
    finished: (async () => {
      while (running && !stop()) await sleep(200);
      if (!running) throw new Error(`The screen recording stopped early:\n${output}`);
      recorder.kill("SIGINT");
      await exited;
      writeFileSync(log, output);
    })(),
  };
}

/** Runs the tests and records each clip, into captures/ios-run. Returns the tests' exit status. */
async function captureRun(): Promise<number> {
  if (existsSync(testFile)) throw new Error(`${testFile} exists: remove it (left by a killed run) and run again`);
  rmSync(run, { recursive: true, force: true });
  mkdirSync(run, { recursive: true });
  mkdirSync(testDir, { recursive: true });
  copyFileSync(join(here, "ios/ClipCaptureTests.swift"), testFile);
  process.on("exit", () => rmSync(testDir, { recursive: true, force: true }));
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => process.exit(130));

  // Any URL and token: the demo needs no server, and these tests never ask for the stack.
  const tests = spawn(join(ios, "scripts/ios.sh"), ["ui-test", "full"], {
    stdio: ["ignore", "inherit", "inherit"],
    env: xcodeEnv({
      PENNY_API_URL: "http://127.0.0.1:9",
      PENNY_TEST_TOKEN: "unused",
      PENNY_UI_DEVICES: "iphone",
      PENNY_UI_ONLY: "PennyUITests/ClipCaptureTests",
      TEST_RUNNER_PENNY_CLIP_OUT: run,
    }),
  });
  let status: number | undefined;
  tests.on("exit", (code) => (status = code ?? 1));

  const pending = new Set<string>(CLIPS);
  while (status === undefined && pending.size > 0) {
    await sleep(200);
    const clip = [...pending].find((name) => existsSync(join(run, `ready-${name}`)));
    if (!clip) continue;
    pending.delete(clip);
    const device = bootedRunDevice();
    if (!device) throw new Error("The test is ready, but no simulator of this run is booted");
    simctl("status_bar", device, "override", "--time", "9:41", "--dataNetwork", "wifi", "--wifiBars", "3", "--cellularBars", "4", "--batteryState", "charged", "--batteryLevel", "100");
    const recording = await recordScreen(device, join(run, `${clip}.mov`), join(run, `${clip}.log`), () => status !== undefined || existsSync(join(run, `${clip}.json`)));
    writeFileSync(join(run, `recording-${clip}`), String(recording.started));
    await recording.finished;
  }
  while (status === undefined) await sleep(200);
  return status;
}

interface Timeline {
  screen: { width: number; height: number };
  events: Record<string, { t: number; box?: Capture["events"][string]["box"] }>;
}

/** Cuts a clip's stretch out of its recording into captures/<clip>: frames and capture.json. */
function cut(clip: string) {
  const file = join(run, `${clip}.json`);
  if (!existsSync(file)) {
    console.error(`${clip}: the test didn't finish, no capture`);
    return false;
  }
  const timeline = JSON.parse(readFileSync(file, "utf8")) as Timeline;
  const recordingStart = Number(readFileSync(join(run, `recording-${clip}`), "utf8"));
  const start = timeline.events.start?.t;
  const end = timeline.events.end?.t;
  if (start === undefined || end === undefined) throw new Error(`${clip}: the timeline has no start or end`);
  const dir = join(captures, clip);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "frames"), { recursive: true });
  const duration = end - start;
  const { width, height } = timeline.screen;
  // The recording only gets a frame when the screen changes: fps= repeats the last one between.
  execFileSync(ffmpeg, [
    "-loglevel", "error", "-i", join(run, `${clip}.mov`), "-ss", (start - recordingStart).toFixed(3), "-t", duration.toFixed(3),
    "-vf", `fps=${FPS},scale=${width * SCALE}:${height * SCALE}:flags=lanczos`,
    "-pix_fmt", "yuvj420p", "-q:v", "2", "-start_number", "0", join(dir, "frames/%06d.jpg"),
  ]);
  const frames = readdirSync(join(dir, "frames"))
    .filter((name) => name.endsWith(".jpg"))
    .sort()
    .map((name, index) => ({ t: index / FPS, file: `frames/${name}` }));
  if (frames.length === 0) throw new Error(`${clip}: no frames in the recording's stretch`);
  const events: Capture["events"] = {};
  for (const [name, event] of Object.entries(timeline.events)) events[name] = { t: event.t - start, ...(event.box ? { box: event.box } : {}) };
  const capture: Capture = { width, height, scale: SCALE, duration, frames, events };
  writeFileSync(join(dir, "capture.json"), JSON.stringify(capture, null, 2));
  console.log(`${clip}: ${frames.length} frames over ${duration.toFixed(2)} s, ${Object.keys(events).join(", ")}`);
  return true;
}

const status = process.argv.includes("--reuse") ? 0 : await captureRun();
const cutAll = CLIPS.map(cut).every(Boolean);
process.exit(status !== 0 ? status : cutAll ? 0 : 1);
