import type { SplatBuilder, SplatInput, Vec3 } from "../splats/cloud.ts";

/** Splat size for `count` flat splats covering `area`, overlapping enough to look solid. */
export function surfaceSigma(area: number, count: number, overlap = 0.62): number {
  return Math.sqrt(area / Math.max(1, count)) * overlap;
}

/**
 * Point i of the R2 low-discrepancy sequence in the unit square. Surfaces sampled with it
 * cover evenly with no clumps or holes, unlike independent random points.
 */
export function r2(i: number): [number, number] {
  return [(0.5 + i * 0.7548776662466927) % 1, (0.5 + i * 0.5698402909980532) % 1];
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Point i of n on a Vogel spiral: an even fill of the unit disk. Returns radius and angle. */
export function vogel(i: number, n: number): [number, number] {
  return [Math.sqrt((i + 0.5) / n), i * GOLDEN_ANGLE];
}

/** A local coordinate frame: maps an object built around the origin into the scene. */
export interface Frame {
  readonly origin: Vec3;
  readonly x: Vec3;
  readonly y: Vec3;
  readonly z: Vec3;
  readonly scale: number;
}

export const IDENTITY_FRAME: Frame = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], scale: 1 };

function apply(f: Frame, v: Vec3): [number, number, number] {
  return [
    f.x[0] * v[0] + f.y[0] * v[1] + f.z[0] * v[2],
    f.x[1] * v[0] + f.y[1] * v[1] + f.z[1] * v[2],
    f.x[2] * v[0] + f.y[2] * v[1] + f.z[2] * v[2],
  ];
}

/** Pushes a splat given in the frame's local coordinates. */
export function pushIn(builder: SplatBuilder, frame: Frame, splat: SplatInput): void {
  const p = apply(frame, splat.position);
  builder.push({
    ...splat,
    position: [frame.origin[0] + p[0] * frame.scale, frame.origin[1] + p[1] * frame.scale, frame.origin[2] + p[2] * frame.scale],
    scale: [splat.scale[0] * frame.scale, splat.scale[1] * frame.scale, splat.scale[2] * frame.scale],
    normal: apply(frame, splat.normal ?? [0, 0, 1]),
    tangent: apply(frame, splat.tangent ?? [1, 0, 0]),
  });
}
