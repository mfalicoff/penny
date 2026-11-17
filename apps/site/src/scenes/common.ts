import { normalize, type SplatBuilder, type SplatInput, type Vec3 } from "../splats/cloud.ts";
import { gaussian, type Random } from "../splats/random.ts";

/** Soft, faint, large splats scattered around `around`: the glow that makes splats read as light. */
export function halo(
  builder: SplatBuilder,
  count: number,
  random: Random,
  around: () => Vec3,
  colors: readonly Vec3[],
  { spread = 0.12, size = [0.025, 0.08], opacity = [0.04, 0.12] }: {
    spread?: number;
    size?: readonly [number, number];
    opacity?: readonly [number, number];
  } = {},
): void {
  for (let i = 0; i < count; i++) {
    const c = around();
    const s = size[0] + (size[1] - size[0]) * random() ** 2;
    builder.push({
      position: [c[0] + gaussian(random) * spread, c[1] + gaussian(random) * spread, c[2] + gaussian(random) * spread],
      scale: [s, s, s],
      color: colors[Math.floor(random() * colors.length)]!,
      opacity: opacity[0] + (opacity[1] - opacity[0]) * random(),
    });
  }
}

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

/** Frame at `origin` whose local z axis points along `axis`, turned by `roll` around it. */
export function frameAlong(origin: Vec3, axis: Vec3, scale = 1, roll = 0): Frame {
  const z = normalize(axis);
  const helper: Vec3 = Math.abs(z[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
  const x0 = normalize([helper[1] * z[2] - helper[2] * z[1], helper[2] * z[0] - helper[0] * z[2], helper[0] * z[1] - helper[1] * z[0]]);
  const y0: Vec3 = [z[1] * x0[2] - z[2] * x0[1], z[2] * x0[0] - z[0] * x0[2], z[0] * x0[1] - z[1] * x0[0]];
  const c = Math.cos(roll), s = Math.sin(roll);
  const x: Vec3 = [x0[0] * c + y0[0] * s, x0[1] * c + y0[1] * s, x0[2] * c + y0[2] * s];
  const y: Vec3 = [y0[0] * c - x0[0] * s, y0[1] * c - x0[1] * s, y0[2] * c - x0[2] * s];
  return { origin, x, y, z, scale };
}

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
