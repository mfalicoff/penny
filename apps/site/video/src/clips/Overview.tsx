import { AbsoluteFill } from "remotion";
import { event, paced, timeOf, type Capture } from "../capture.ts";
import { Camera, closeUp, full } from "../lib/Camera.tsx";
import { Highlight } from "../lib/Highlight.tsx";
import { LoopBack } from "../lib/LoopBack.tsx";
import { centre } from "../lib/motion.ts";
import { Screen } from "../lib/Screen.tsx";
import { Touch } from "../lib/Touch.tsx";

const KEYS = ["key0", "key1", "key2", "key3", "key4"];

/**
 * Overview, 7 s: Home, then Add entry: 18.50 on the keypad, Food & drinks, "Lunch", Save, and
 * Left to spend counts down (storyboard: apps/site/docs/product-videos.md). The simulator's
 * pace is fitted to the storyboard's beats with `paced`.
 */
export function Overview({ capture: recorded }: { capture: Capture }) {
  const at = (name: string) => timeOf(recorded, name);
  const capture = paced(recorded, [
    [0, 0],
    [at("add"), 1.0],
    [at("key0"), 1.65],
    ...KEYS.slice(1).map((key, index) => [at(key), 1.85 + index * 0.2] as const),
    [at("category"), 2.85],
    [at("title"), 3.2],
    [at("save"), 4.0],
    [at("saved"), 4.4],
    [at("left"), 4.9],
    [at("end"), 6.55],
  ]);
  const add = event(capture, "add");
  const amount = event(capture, "amount");
  const keys = KEYS.map((key) => event(capture, key));
  const category = event(capture, "category");
  const title = event(capture, "title");
  const save = event(capture, "save");
  const saved = timeOf(capture, "saved");
  const left = event(capture, "left");
  const end = capture.duration;
  // At most 1.2×, as storyboarded, but never so close that the amount and its ring are cut.
  const zoom = Math.min(1.2, capture.width / (amount.box.width + 28));
  const sheetShot = closeUp(capture, { x: capture.width / 2, y: (amount.box.y + category.box.y) / 2 }, zoom);
  const tap = (box: { x: number; y: number; width: number; height: number }, t: number) => ({ t, ...centre(box) });
  return (
    <AbsoluteFill>
      <Camera
        screen={capture}
        shots={[
          { t: 0, value: full(capture) },
          { t: add.t + 0.1, value: full(capture) },
          { t: amount.t + 0.2, value: sheetShot },
          { t: save.t, value: sheetShot },
          { t: saved + 0.4, value: full(capture) },
        ]}
      >
        <Screen clip="overview" capture={capture} />
        <Highlight box={amount.box} from={keys[0]!.t - 0.1} to={category.t - 0.05} />
        <Highlight box={category.box} from={category.t + 0.05} to={title.t + 0.3} />
        <Highlight box={left.box} from={left.t - 0.2} to={end - 0.15} />
        <Touch
          taps={[
            tap(add.box, add.t),
            ...keys.map((key) => tap(key.box, key.t)),
            tap(category.box, category.t),
            tap(title.box, title.t),
            tap(save.box, save.t),
          ]}
        />
        <LoopBack clip="overview" capture={capture} />
      </Camera>
    </AbsoluteFill>
  );
}
