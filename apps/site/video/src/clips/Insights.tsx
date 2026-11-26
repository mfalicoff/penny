import { AbsoluteFill } from "remotion";
import { event, type Box, type Capture } from "../capture.ts";
import { Camera, closeUp, full } from "../lib/Camera.tsx";
import { Cursor } from "../lib/Cursor.tsx";
import { Highlight } from "../lib/Highlight.tsx";
import { centre } from "../lib/motion.ts";
import { Screen } from "../lib/Screen.tsx";

/**
 * Insights, 7 s: a slow push-in on the money flow, Groceries selected, then Left over, and back
 * out to the first frame (storyboard: apps/site/docs/product-videos.md).
 */
export function Insights({ capture }: { capture: Capture }) {
  const card = event(capture, "start");
  const groceries = event(capture, "groceries");
  const leftOver = event(capture, "left-over");
  const clear = event(capture, "clear");
  const end = capture.duration;
  // Frame the whole flow at the label's height: the labels sit at the flow's right edge.
  const onFlow = (label: Box) => ({ x: centre(card.box).x, y: centre(label).y });
  const groceriesShot = closeUp(capture, onFlow(groceries.box), 1.4);
  const leftOverShot = closeUp(capture, onFlow(leftOver.box), 1.4);
  // Point at the band's end, left of its label, so the cursor never covers the text; ring the
  // label with the amount under it.
  const node = (label: Box) => ({ x: label.x - 12, y: label.y + label.height / 2 + 6 });
  const ring = (label: Box): Box => ({ x: label.x - 16, y: label.y - 3, width: label.width + 44, height: label.height + 20 });
  return (
    <AbsoluteFill>
      <Camera
        screen={capture}
        shots={[
          { t: 0, value: full(capture) },
          { t: groceries.t - 0.2, value: closeUp(capture, centre(card.box), 1.12) },
          { t: groceries.t + 0.7, value: groceriesShot },
          { t: leftOver.t - 0.3, value: groceriesShot },
          { t: leftOver.t + 0.5, value: leftOverShot },
          { t: clear.t + 0.3, value: leftOverShot },
          { t: end - 0.4, value: full(capture) },
        ]}
      >
        <Screen clip="insights" capture={capture} />
        <Highlight box={ring(groceries.box)} from={groceries.t + 0.1} to={leftOver.t - 0.2} padding={4} />
        <Highlight box={ring(leftOver.box)} from={leftOver.t + 0.1} to={clear.t + 0.1} padding={4} />
        <Cursor
          path={[
            { t: 0.6, value: { x: node(groceries.box).x - 160, y: centre(card.box).y + 120 } },
            { t: groceries.t - 0.1, value: node(groceries.box) },
            { t: leftOver.t - 0.6, value: node(groceries.box) },
            { t: leftOver.t - 0.05, value: node(leftOver.box) },
            { t: clear.t + 0.2, value: node(leftOver.box) },
            { t: end - 0.6, value: { x: node(leftOver.box).x - 140, y: node(leftOver.box).y + 70 } },
          ]}
          presses={[groceries.t, leftOver.t, clear.t]}
          hideAt={end - 0.5}
        />
      </Camera>
    </AbsoluteFill>
  );
}
