// Packs scenes into the texture layout the vertex shader reads: one block of rows per scene,
// TEXTURE_WIDTH texels per row, splat i at (i % width, i / width + scene * rows). Scenes are
// packed one at a time so the page can show the first while the rest are generated.
import { covariance, type SplatCloud } from "./cloud.ts";
import { delayFor } from "./morph.ts";
import { createRandom } from "./random.ts";

export const TEXTURE_WIDTH = 2048;

export interface Layout {
  readonly count: number;
  readonly sceneCount: number;
  readonly width: number;
  /** Rows per scene. */
  readonly rows: number;
}

/** One scene's block of rows in every texture. */
export interface PackedScene {
  readonly index: number;
  /** x, y, z, morph delay. RGBA32F. */
  readonly centers: Float32Array;
  /** Covariance c00, c01, c02, c11. RGBA32F. */
  readonly covA: Float32Array;
  /** Covariance c12, c22. RG32F. */
  readonly covB: Float32Array;
  /** sRGB colour and opacity. RGBA8. */
  readonly colors: Uint8Array;
  /** Normal and shading amount. RGBA8. */
  readonly normals: Uint8Array;
}

export function layoutFor(count: number, sceneCount: number): Layout {
  return { count, sceneCount, width: TEXTURE_WIDTH, rows: Math.max(1, Math.ceil(count / TEXTURE_WIDTH)) };
}

/** Per-splat morph delay in [0, 1], shared by every scene. */
export function morphDelays(count: number, seed = 99): Float32Array {
  const random = createRandom(seed);
  const delays = new Float32Array(count);
  for (let i = 0; i < count; i++) delays[i] = delayFor(i, count, random());
  return delays;
}

export function packScene(scene: SplatCloud, index: number, layout: Layout, delays: Float32Array): PackedScene {
  if (scene.count !== layout.count) throw new Error(`Scene ${index} has ${scene.count} splats, not ${layout.count}`);
  const texels = layout.width * layout.rows;
  const centers = new Float32Array(texels * 4);
  const covA = new Float32Array(texels * 4);
  const covB = new Float32Array(texels * 2);
  const colors = new Uint8Array(texels * 4);
  const normals = new Uint8Array(texels * 4);
  const cov = new Float32Array(6);
  for (let i = 0; i < scene.count; i++) {
    centers[i * 4] = scene.positions[i * 3]!;
    centers[i * 4 + 1] = scene.positions[i * 3 + 1]!;
    centers[i * 4 + 2] = scene.positions[i * 3 + 2]!;
    centers[i * 4 + 3] = delays[i]!;
    covariance(scene.scales, i * 3, scene.rotations, i * 4, cov, 0);
    covA[i * 4] = cov[0]!;
    covA[i * 4 + 1] = cov[1]!;
    covA[i * 4 + 2] = cov[2]!;
    covA[i * 4 + 3] = cov[3]!;
    covB[i * 2] = cov[4]!;
    covB[i * 2 + 1] = cov[5]!;
  }
  colors.set(scene.colors);
  normals.set(scene.normals);
  return { index, centers, covA, covB, colors, normals };
}
