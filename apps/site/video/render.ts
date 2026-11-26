// Renders the product page's clips from their captures and encodes them for the page.
//
//   node render.ts [clip...]        (default: every clip that has a capture and a composition)
//
// For each clip: Remotion renders a high-quality master (out/<clip>.mp4, gitignored), then
// ffmpeg encodes what the page loads, into ../src/assets/clips:
//   <clip>.webm / <clip>.mp4              AV1 WebM and H.264 MP4 for Safari, no audio
//   <clip>-720.webm / <clip>-720.mp4      the half-size variants (browser clips only)
//   <clip>-poster.webp                    the first frame, shown until the video can play
// It fails when a file is over the clip's budget (src/clips.ts).
//
// Needs ffmpeg with libsvtav1, libx264 and libwebp (FFMPEG overrides the one on PATH), and
// REMOTION_CHROME on NixOS (see remotion.config.ts).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { CLIPS, type Clip } from "./src/clips.ts";

const here = import.meta.dirname;
const out = join(here, "out");
const assets = resolve(here, "../src/assets/clips");
const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
/** Clips with a composition in src/Root.tsx. */
const COMPOSED = new Set(["insights", "apps"]);

function run(command: string, args: string[]) {
  // SVT_LOG=1: SVT-AV1 prints its configuration unless told to report errors only.
  execFileSync(command, args, { cwd: here, stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, SVT_LOG: "1" } });
}

function encode(master: string, target: string, codec: "av1" | "h264", width?: number) {
  const scale = width ? ["-vf", `scale=${width}:-2:flags=lanczos`] : [];
  const video =
    codec === "av1"
      ? ["-c:v", "libsvtav1", "-crf", "38", "-preset", "6", "-g", "240", "-pix_fmt", "yuv420p"]
      : ["-c:v", "libx264", "-crf", "26", "-preset", "slow", "-profile:v", "high", "-pix_fmt", "yuv420p", "-movflags", "+faststart"];
  run(ffmpeg, ["-y", "-loglevel", "error", "-i", master, ...scale, ...video, "-an", "-map_metadata", "-1", target]);
}

function checkBudget(file: string, limit: number | undefined): string | null {
  const size = statSync(file).size;
  console.log(`  ${file.slice(assets.length + 1)}: ${(size / 1_000_000).toFixed(2)} MB`);
  return limit !== undefined && size > limit ? `${file} is ${size} bytes, over its ${limit}-byte budget` : null;
}

function render(clip: Clip): string[] {
  const master = join(out, `${clip.id}.mp4`);
  run("npx", ["remotion", "render", "src/index.ts", clip.id, master, "--codec=h264", "--crf=10"]);

  const file = (suffix: string) => join(assets, `${clip.id}${suffix}`);
  encode(master, file(".webm"), "av1");
  encode(master, file(".mp4"), "h264");
  if (clip.small) {
    encode(master, file("-720.webm"), "av1", clip.small.width);
    encode(master, file("-720.mp4"), "h264", clip.small.width);
  }
  run(ffmpeg, ["-y", "-loglevel", "error", "-i", master, "-frames:v", "1", "-c:v", "libwebp", "-quality", "86", file("-poster.webp")]);

  console.log(`${clip.id}:`);
  const problems = [
    checkBudget(file(".webm"), clip.budget.webm),
    checkBudget(file(".mp4"), clip.budget.mp4),
    ...(clip.small ? [checkBudget(file("-720.webm"), clip.budget.smallWebm), checkBudget(file("-720.mp4"), clip.budget.smallMp4)] : []),
    checkBudget(file("-poster.webp"), undefined),
  ];
  return problems.filter((problem): problem is string => problem !== null);
}

const requested = process.argv.slice(2);
for (const id of requested) if (!CLIPS.some((clip) => clip.id === id)) throw new Error(`Unknown clip "${id}"`);
mkdirSync(out, { recursive: true });
mkdirSync(assets, { recursive: true });

const problems: string[] = [];
for (const clip of CLIPS) {
  if (requested.length > 0 && !requested.includes(clip.id)) continue;
  if (!COMPOSED.has(clip.id)) {
    console.log(`${clip.id}: no composition yet (recorded on the Mac from the iOS simulator), skipped`);
    continue;
  }
  if (!existsSync(join(here, "captures", clip.id, "capture.json"))) {
    console.log(`${clip.id}: no capture, skipped (run \`npm run capture:${clip.source}\` first)`);
    continue;
  }
  problems.push(...render(clip));
}
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
