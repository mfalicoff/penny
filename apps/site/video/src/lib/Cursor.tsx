import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { ease, keyed, type Key } from "./motion.ts";

const RIPPLE = 0.45;

/**
 * A soft white dot that glides between `path` points (screen CSS pixels) and ripples at each
 * time in `presses`. It fades in at the first key and out at `hideAt`.
 */
export function Cursor({ path, presses, hideAt }: { path: readonly Key<{ x: number; y: number }>[]; presses: readonly number[]; hideAt: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const showAt = path[0]?.t ?? 0;
  const opacity = interpolate(t, [showAt, showAt + 0.3, hideAt - 0.3, hideAt], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (opacity === 0) return null;
  const { x, y } = keyed(path, t);
  const press = presses.find((at) => t >= at && t < at + RIPPLE);
  const pressed = press === undefined ? 0 : interpolate(t, [press, press + RIPPLE], [0, 1], { easing: ease });
  return (
    <div style={{ position: "absolute", left: x, top: y, opacity }}>
      {press !== undefined && (
        <div
          style={{
            position: "absolute",
            left: -11 - pressed * 18,
            top: -11 - pressed * 18,
            width: 22 + pressed * 36,
            height: 22 + pressed * 36,
            borderRadius: "50%",
            border: "2px solid rgba(255, 255, 255, 0.8)",
            opacity: 1 - pressed,
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          left: -11,
          top: -11,
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: "rgba(255, 255, 255, 0.92)",
          boxShadow: "0 0 0 5px rgba(255, 255, 255, 0.22), 0 2px 10px rgba(0, 0, 0, 0.5)",
          transform: `scale(${1 - 0.18 * Math.sin(Math.PI * Math.min(pressed * 2, 1))})`,
        }}
      />
    </div>
  );
}
