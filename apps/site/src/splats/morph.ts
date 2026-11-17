// How a splat travels from one scene to the next. The vertex shader (shaders.ts) implements
// the same formulas; the sort worker uses these to order splats by their on-screen depth.
import type { Mat4 } from "./mat4.ts";

/** Fraction of the morph spent waiting for a splat's turn: the sweep across the frame. */
export const STAGGER = 0.55;
/** How far splats swing out of their path mid-flight. */
export const SWIRL = 0.42;

/** Per-splat start delay in [0, 1]: mostly its position in the shared order, plus jitter. */
export function delayFor(index: number, count: number, jitter: number): number {
  return 0.8 * (index / Math.max(1, count - 1)) + 0.2 * jitter;
}

/** Eased progress of one splat through a morph at overall progress `t`. */
export function morphProgress(t: number, delay: number): number {
  const e = Math.min(1, Math.max(0, (t - delay * STAGGER) / (1 - STAGGER)));
  return e * e * (3 - 2 * e);
}

/**
 * View-space depth (camera looks down −z) of splat `i` mid-morph. Mirrors the vertex shader.
 */
export function morphedViewZ(
  a: Float32Array,
  b: Float32Array,
  i: number,
  delay: number,
  t: number,
  modelA: Mat4,
  modelB: Mat4,
  view: Mat4,
): number {
  const e = morphProgress(t, delay);
  const lift = Math.sin(Math.PI * e) * SWIRL;
  const ax = a[i * 3]!, ay = a[i * 3 + 1]!, az = a[i * 3 + 2]!;
  const bx = b[i * 3]!, by = b[i * 3 + 1]!, bz = b[i * 3 + 2]!;
  const pax = modelA[0]! * ax + modelA[4]! * ay + modelA[8]! * az + modelA[12]!;
  const pay = modelA[1]! * ax + modelA[5]! * ay + modelA[9]! * az + modelA[13]!;
  const paz = modelA[2]! * ax + modelA[6]! * ay + modelA[10]! * az + modelA[14]!;
  const pbx = modelB[0]! * bx + modelB[4]! * by + modelB[8]! * bz + modelB[12]!;
  const pby = modelB[1]! * bx + modelB[5]! * by + modelB[9]! * bz + modelB[13]!;
  const pbz = modelB[2]! * bx + modelB[6]! * by + modelB[10]! * bz + modelB[14]!;
  const x = pax + (pbx - pax) * e + lift * Math.sin(delay * 7919.1);
  const y = pay + (pby - pay) * e + lift * Math.sin(delay * 3571.7 + 1.3);
  const z = paz + (pbz - paz) * e + lift * Math.sin(delay * 1237.3 + 2.1);
  return view[2]! * x + view[6]! * y + view[10]! * z + view[14]!;
}
