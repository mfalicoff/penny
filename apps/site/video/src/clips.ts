/**
 * Every clip on the product page. The compositions (src/Root.tsx) and the render script
 * (render.ts) read this list. Sizes are 2× what the page displays.
 */
export interface Clip {
  id: string;
  /** Where the recording comes from: the web demo on Linux, or the iOS simulator on the Mac. */
  source: "web" | "ios";
  width: number;
  height: number;
  seconds: number;
  /** A half-size variant for phone widths (browser frames only). */
  small?: { width: number; height: number };
  /** Largest file sizes in bytes, per format (apps/site/docs/product-videos.md#size-budget). */
  budget: { webm: number; mp4: number; smallWebm?: number; smallMp4?: number };
}

export const FPS = 30;

const WEB_BUDGET = { webm: 1_200_000, mp4: 2_000_000, smallWebm: 400_000, smallMp4: 700_000 };
const IPHONE_BUDGET = { webm: 800_000, mp4: 1_300_000 };

export const CLIPS: readonly Clip[] = [
  { id: "insights", source: "web", width: 1440, height: 900, seconds: 7, small: { width: 720, height: 450 }, budget: WEB_BUDGET },
  { id: "apps", source: "web", width: 1440, height: 900, seconds: 6, small: { width: 720, height: 450 }, budget: WEB_BUDGET },
  // Recorded on the Mac from the iOS simulator. Their compositions come with the recordings.
  { id: "overview", source: "ios", width: 590, height: 1284, seconds: 7, budget: IPHONE_BUDGET },
  { id: "entries", source: "ios", width: 590, height: 1284, seconds: 6, budget: IPHONE_BUDGET },
];
