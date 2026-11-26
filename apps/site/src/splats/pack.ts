// Packs a scene into the textures the vertex shader reads: TEXTURE_WIDTH texels per row,
// splat i at (i % width, i / width).
import { covariance, type SplatCloud } from "./cloud.ts";

export const TEXTURE_WIDTH = 2048;

export interface Layout {
  readonly count: number;
  readonly width: number;
  readonly rows: number;
}

export interface PackedScene {
  /** x, y, z, and how far the splat drifts (dust only). RGBA32F. */
  readonly centers: Float32Array;
  /** Covariance c00, c01, c02, c11. RGBA32F. */
  readonly covA: Float32Array;
  /** Covariance c12, c22. RG32F. */
  readonly covB: Float32Array;
  /** sRGB colour and opacity. RGBA8. */
  readonly colors: Uint8Array;
  /**
   * Normal and how much it's lit. RGBA16F: 8-bit normals band the specular highlight, which
   * is what drew stripes across the coin's face.
   */
  readonly normals: Uint16Array;
}

export function layoutFor(count: number): Layout {
  return { count, width: TEXTURE_WIDTH, rows: Math.max(1, Math.ceil(count / TEXTURE_WIDTH)) };
}

/** IEEE half-precision bits of `value` (round to nearest), for RGBA16F uploads. */
export function toHalf(value: number): number {
  const f32 = new Float32Array([value]);
  const bits = new Uint32Array(f32.buffer)[0]!;
  const sign = (bits >>> 16) & 0x8000;
  const exponent = ((bits >>> 23) & 0xff) - 127 + 15;
  const mantissa = bits & 0x7fffff;
  if (exponent <= 0) return sign;
  if (exponent >= 31) return sign | 0x7c00;
  const half = sign | (exponent << 10) | (mantissa >>> 13);
  return mantissa & 0x1000 ? half + 1 : half;
}

export function packScene(scene: SplatCloud, layout: Layout): PackedScene {
  if (scene.count !== layout.count) throw new Error(`The scene has ${scene.count} splats, not ${layout.count}`);
  const texels = layout.width * layout.rows;
  const centers = new Float32Array(texels * 4);
  const covA = new Float32Array(texels * 4);
  const covB = new Float32Array(texels * 2);
  const colors = new Uint8Array(texels * 4);
  const normals = new Uint16Array(texels * 4);
  const cov = new Float32Array(6);
  for (let i = 0; i < scene.count; i++) {
    centers[i * 4] = scene.positions[i * 3]!;
    centers[i * 4 + 1] = scene.positions[i * 3 + 1]!;
    centers[i * 4 + 2] = scene.positions[i * 3 + 2]!;
    centers[i * 4 + 3] = scene.drift[i]!;
    covariance(scene.scales, i * 3, scene.rotations, i * 4, cov, 0);
    covA[i * 4] = cov[0]!;
    covA[i * 4 + 1] = cov[1]!;
    covA[i * 4 + 2] = cov[2]!;
    covA[i * 4 + 3] = cov[3]!;
    covB[i * 2] = cov[4]!;
    covB[i * 2 + 1] = cov[5]!;
    for (let k = 0; k < 4; k++) normals[i * 4 + k] = toHalf(scene.normals[i * 4 + k]!);
  }
  colors.set(scene.colors);
  return { centers, covA, covB, colors, normals };
}
