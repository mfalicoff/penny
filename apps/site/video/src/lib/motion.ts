import { Easing, interpolate } from "remotion";
import type { Box } from "../capture.ts";

/** Penny's easing for every move: slow in and out, no overshoot. */
export const ease = Easing.bezier(0.45, 0, 0.2, 1);

export interface Key<T> {
  /** Seconds. */
  t: number;
  value: T;
}

/** The value at `t`: held before the first key and after the last, eased between keys. */
export function keyed<T extends object>(keys: readonly Key<T>[], t: number): T {
  const first = keys[0];
  if (!first) throw new Error("keyed() needs at least one key");
  let previous = first;
  for (const key of keys) {
    if (key.t >= t) {
      if (key === previous || key.t === previous.t) return key.value;
      const progress = interpolate(t, [previous.t, key.t], [0, 1], { easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      const from = previous.value as Record<string, number>;
      const mixed: Record<string, number> = {};
      for (const [name, to] of Object.entries(key.value as Record<string, number>)) mixed[name] = (from[name] ?? to) + (to - (from[name] ?? to)) * progress;
      return mixed as T;
    }
    previous = key;
  }
  return previous.value;
}

export function centre(box: Box): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
