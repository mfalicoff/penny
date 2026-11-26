import { AbsoluteFill } from "remotion";
import { event, type Capture } from "../capture.ts";
import { Camera, closeUp, full } from "../lib/Camera.tsx";
import { Cursor } from "../lib/Cursor.tsx";
import { Highlight } from "../lib/Highlight.tsx";
import { centre } from "../lib/motion.ts";
import { Screen } from "../lib/Screen.tsx";

/**
 * Apps, 6 s: Home, a close-up on the search field while "groc" is typed (the app's own focus
 * ring marks it), the matches across months in Activity, and back to Home (storyboard:
 * apps/site/docs/product-videos.md).
 */
export function Apps({ capture }: { capture: Capture }) {
  const leftToSpend = event(capture, "start");
  const search = event(capture, "search");
  const results = event(capture, "results");
  const home = event(capture, "home");
  const end = capture.duration;
  const searchShot = closeUp(capture, centre(search.box), 1.6);
  // Click at the field's start, then step aside so the cursor doesn't cover what's typed.
  const field = { x: search.box.x + 18, y: centre(search.box).y };
  const aside = { x: field.x - 70, y: field.y + 56 };
  return (
    <AbsoluteFill>
      <Camera
        screen={capture}
        shots={[
          { t: 0, value: full(capture) },
          { t: search.t - 0.4, value: full(capture) },
          { t: search.t + 0.5, value: searchShot },
          { t: results.t - 0.2, value: searchShot },
          { t: results.t + 0.7, value: full(capture) },
        ]}
      >
        <Screen clip="apps" capture={capture} />
        <Highlight box={leftToSpend.box} from={0.2} to={search.t - 0.3} />
        <Cursor
          path={[
            { t: search.t - 0.6, value: { x: field.x - 240, y: field.y + 160 } },
            { t: search.t - 0.05, value: field },
            { t: search.t + 0.35, value: field },
            { t: search.t + 0.8, value: aside },
            { t: home.t - 0.7, value: aside },
            { t: home.t - 0.05, value: centre(home.box) },
            { t: end - 0.7, value: { x: centre(home.box).x + 120, y: centre(home.box).y + 140 } },
          ]}
          presses={[search.t, home.t]}
          hideAt={end - 0.6}
        />
      </Camera>
    </AbsoluteFill>
  );
}
