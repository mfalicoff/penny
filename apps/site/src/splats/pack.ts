// Packs scenes into the texture layout the vertex shader reads: one block of rows per scene,
// TEXTURE_WIDTH texels per row, splat i at (i % width, i / width + scene * rows).
import { covariance, type SplatCloud } from "./cloud.ts";
import { delayFor } from "./morph.ts";
import { createRandom } from "./random.ts";

export const TEXTURE_WIDTH = 2048;

export interface PackedScenes {
  readonly count: number;
  readonly sceneCount: number;
  readonly width: number;
  /** Rows per scene. */
  readonly rows: number;
  /** x, y, z, morph delay. RGBA32F. */
  readonly centers: Float32Array;
  /** Covariance c00, c01, c02, c11. RGBA32F. */
  readonly covA: Float32Array;
  /** Covariance c12, c22. RG32F. */
  readonly covB: Float32Array;
  /** sRGB colour and opacity. RGBA8. */
  readonly colors: Uint8Array;
  /** Per-splat morph delay, shared by every scene. */
  readonly delays: Float32Array;
}

export function packScenes(scenes: readonly SplatCloud[], seed = 99): PackedScenes {
  const count = scenes[0]?.count ?? 0;
  if (scenes.some((s) => s.count !== count)) throw new Error("Every scene needs the same splat count");
  const width = TEXTURE_WIDTH;
  const rows = Math.max(1, Math.ceil(count / width));
  const texels = width * rows * scenes.length;
  const centers = new Float32Array(texels * 4);
  const covA = new Float32Array(texels * 4);
  const covB = new Float32Array(texels * 2);
  const colors = new Uint8Array(texels * 4);
  const delays = new Float32Array(count);
  const random = createRandom(seed);
  for (let i = 0; i < count; i++) delays[i] = delayFor(i, count, random());

  const cov = new Float32Array(6);
  scenes.forEach((scene, s) => {
    const base = s * rows * width;
    for (let i = 0; i < count; i++) {
      const t = base + i;
      centers[t * 4] = scene.positions[i * 3]!;
      centers[t * 4 + 1] = scene.positions[i * 3 + 1]!;
      centers[t * 4 + 2] = scene.positions[i * 3 + 2]!;
      centers[t * 4 + 3] = delays[i]!;
      covariance(scene.scales, i * 3, scene.rotations, i * 4, cov, 0);
      covA[t * 4] = cov[0]!;
      covA[t * 4 + 1] = cov[1]!;
      covA[t * 4 + 2] = cov[2]!;
      covA[t * 4 + 3] = cov[3]!;
      covB[t * 2] = cov[4]!;
      covB[t * 2 + 1] = cov[5]!;
      colors.set(scene.colors.subarray(i * 4, i * 4 + 4), t * 4);
    }
  });
  return { count, sceneCount: scenes.length, width, rows, centers, covA, covB, colors, delays };
}
