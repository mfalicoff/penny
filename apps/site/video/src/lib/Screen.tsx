import { Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { frameAt, type Capture } from "../capture.ts";

/** The captured screen at the current time, drawn at its CSS size from its 2× frames. */
export function Screen({ clip, capture }: { clip: string; capture: Capture }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <Img
      src={staticFile(`${clip}/${frameAt(capture, frame / fps)}`)}
      style={{ position: "absolute", left: 0, top: 0, width: capture.width, height: capture.height }}
    />
  );
}
