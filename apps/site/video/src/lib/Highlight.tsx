import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Box } from "../capture.ts";
import { ease } from "./motion.ts";

const FADE = 0.3;

/** A soft Penny-orange ring around `box`, faded in at `from` and out at `to` (seconds). */
export function Highlight({ box, from, to, padding = 8 }: { box: Box; from: number; to: number; padding?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const clamp = { easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
  const opacity = interpolate(t, [from, from + FADE, to - FADE, to], [0, 1, 1, 0], clamp);
  if (opacity === 0) return null;
  const inset = padding + interpolate(t, [from, from + FADE], [6, 0], clamp);
  return (
    <div
      style={{
        position: "absolute",
        left: box.x - inset,
        top: box.y - inset,
        width: box.width + inset * 2,
        height: box.height + inset * 2,
        borderRadius: 12,
        border: "2.5px solid #ff7a45",
        boxShadow: "0 0 0 6px rgba(255, 122, 69, 0.18), 0 0 24px rgba(255, 122, 69, 0.35)",
        opacity,
      }}
    />
  );
}
