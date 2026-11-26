import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { ease } from "./motion.ts";

export interface Tap {
  /** Seconds. */
  t: number;
  /** Screen points. */
  x: number;
  y: number;
}

const BEFORE = 0.12;
const AFTER = 0.35;

/**
 * The iPhone clips' touch indicator: a soft white fingertip that appears on each tap and fades
 * out with a ripple, like the simulator's own, which its screen recordings leave out.
 */
export function Touch({ taps }: { taps: readonly Tap[] }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const tap = taps.find((candidate) => t >= candidate.t - BEFORE && t < candidate.t + AFTER);
  if (!tap) return null;
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
  const opacity = interpolate(t, [tap.t - BEFORE, tap.t, tap.t + AFTER * 0.5, tap.t + AFTER], [0, 1, 0.9, 0], clamp);
  const ripple = interpolate(t, [tap.t, tap.t + AFTER], [0, 1], { ...clamp, easing: ease });
  return (
    <div style={{ position: "absolute", left: tap.x, top: tap.y, opacity }}>
      {t >= tap.t && (
        <div
          style={{
            position: "absolute",
            left: -18 - ripple * 14,
            top: -18 - ripple * 14,
            width: 36 + ripple * 28,
            height: 36 + ripple * 28,
            borderRadius: "50%",
            border: "2px solid rgba(255, 255, 255, 0.75)",
            opacity: 1 - ripple,
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          left: -18,
          top: -18,
          width: 36,
          height: 36,
          borderRadius: "50%",
          background: "rgba(255, 255, 255, 0.55)",
          boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.35), 0 2px 10px rgba(0, 0, 0, 0.45)",
        }}
      />
    </div>
  );
}
