// Writes every scene as a standard 3DGS .ply, to inspect or edit in any splat viewer:
//   npm run splats:export [-- <count> [<directory>]]     (default 120000 splats, ./splats)
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SCENE_IDS } from "../src/scenes/ids.ts";
import { buildScene } from "../src/scenes/index.ts";
import { encodePly } from "../src/splats/ply.ts";

const count = Number(process.argv[2] ?? 120_000);
const directory = resolve(process.argv[3] ?? "splats");
if (!Number.isInteger(count) || count < 1000) throw new Error(`Splat count must be an integer ≥ 1000, got ${process.argv[2]}`);

mkdirSync(directory, { recursive: true });
SCENE_IDS.forEach((id) => {
  const cloud = buildScene(id, count);
  const file = join(directory, `penny-${id}.ply`);
  writeFileSync(file, encodePly(cloud));
  console.log(`${file}  ${cloud.count} splats`);
});
