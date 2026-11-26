import { AbsoluteFill } from "remotion";
import { event, paced, timeOf, type Box, type Capture } from "../capture.ts";
import { Camera, closeUp, full } from "../lib/Camera.tsx";
import { Highlight } from "../lib/Highlight.tsx";
import { LoopBack } from "../lib/LoopBack.tsx";
import { centre } from "../lib/motion.ts";
import { Screen } from "../lib/Screen.tsx";
import { Touch } from "../lib/Touch.tsx";

/**
 * Entries, 6 s: a $74.40 dinner in Add entry, Split, Equally, one more person, your share of
 * $24.80, Done, and the share on the Split row (storyboard: apps/site/docs/product-videos.md).
 * The simulator's pace is fitted to the storyboard's beats with `paced`.
 */
export function Entries({ capture: recorded }: { capture: Capture }) {
  const at = (name: string) => timeOf(recorded, name);
  const capture = paced(recorded, [
    [0, 0],
    [at("split"), 1.0],
    [at("equally"), 1.75],
    [at("more"), 2.35],
    [at("share"), 2.85],
    [at("done"), 4.2],
    [at("row"), 4.65],
    [at("end"), 5.55],
  ]);
  const split = event(capture, "split");
  const equally = event(capture, "equally");
  const more = event(capture, "more");
  const share = event(capture, "share");
  const done = event(capture, "done");
  const row = event(capture, "row");
  const end = capture.duration;
  const controls = { x: capture.width / 2, y: (equally.box.y + share.box.y + share.box.height) / 2 };
  // At most 1.3×, as storyboarded, but never so close that the share card and its ring are cut.
  const splitShot = closeUp(capture, controls, Math.min(1.3, capture.width / (share.box.width + 28)));
  const tap = (box: Box, t: number) => ({ t, ...centre(box) });
  return (
    <AbsoluteFill>
      <Camera
        screen={capture}
        shots={[
          { t: 0, value: full(capture) },
          { t: split.t + 0.1, value: full(capture) },
          { t: equally.t, value: splitShot },
          { t: done.t, value: splitShot },
          { t: row.t, value: full(capture) },
        ]}
      >
        <Screen clip="entries" capture={capture} />
        <Highlight box={share.box} from={share.t} to={done.t - 0.05} />
        <Highlight box={row.box} from={row.t} to={end - 0.15} padding={2} />
        <Touch taps={[tap(split.box, split.t), tap(equally.box, equally.t), tap(more.box, more.t), tap(done.box, done.t)]} />
        <LoopBack clip="entries" capture={capture} />
      </Camera>
    </AbsoluteFill>
  );
}
