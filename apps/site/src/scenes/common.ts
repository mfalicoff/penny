import type { SplatBuilder, Vec3 } from "../splats/cloud.ts";
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

export interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly radius?: number;
  readonly color: Vec3;
}

/** Whether (x, y) is inside a rounded rectangle. */
export function inRoundedRect(x: number, y: number, r: Rect): boolean {
  if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) return false;
  const rad = r.radius ?? 0;
  if (rad <= 0) return true;
  const cx = Math.min(Math.max(x, r.x0 + rad), r.x1 - rad);
  const cy = Math.min(Math.max(y, r.y0 + rad), r.y1 - rad);
  return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
}

/** Colour of the topmost rect under (x, y), or `fallback`. */
export function paint(x: number, y: number, rects: readonly Rect[], fallback: Vec3): Vec3 {
  for (let i = rects.length - 1; i >= 0; i--) {
    if (inRoundedRect(x, y, rects[i]!)) return rects[i]!.color;
  }
  return fallback;
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
