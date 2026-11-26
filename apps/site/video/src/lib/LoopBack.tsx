import { Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Capture } from "../capture.ts";
import { ease } from "./motion.ts";

/**
 * Fades the first frame back in over the clip's last `seconds`, so a clip whose UI doesn't end
 * where it started (a sheet still open, an entry added) loops without a jump. Put it inside the
 * Camera, which is back on the full screen by then.
 */
export function LoopBack({ clip, capture, seconds = 0.45 }: { clip: string; capture: Capture; seconds?: number }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const end = durationInFrames / fps;
  const opacity = interpolate(frame / fps, [end - seconds, end - 1 / fps], [0, 1], { easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const first = capture.frames[0];
  if (opacity === 0 || !first) return null;
  return (
    <Img
      src={staticFile(`${clip}/${first.file}`)}
      style={{ position: "absolute", left: 0, top: 0, width: capture.width, height: capture.height, opacity }}
    />
  );
}
