// What the splats do on the page: which scene each section shows, how each scene moves while
// it rests, and how scrolling between sections scrubs the morph.
import { SCENE_IDS, type SceneId } from "./scenes/ids.ts";
import { compose, rotationX, rotationY, rotationZ, scaling, translation, type Mat4 } from "./splats/mat4.ts";
import { smoothstep } from "./splats/random.ts";

/** Scene shown at each stage; a section's data-stage picks one. Stage 0 is the intro. */
export const STAGES: readonly SceneId[] = ["nebula", "coin", "flow", "receipt", "devices", "coin"];

export function sceneIndex(stage: number): number {
  const id = STAGES[Math.min(Math.max(0, Math.round(stage)), STAGES.length - 1)]!;
  return SCENE_IDS.indexOf(id);
}

/** The resting motion of a scene at `time` seconds. */
export function sceneModel(id: SceneId, time: number, still: boolean): Mat4 {
  const t = still ? 0 : time;
  switch (id) {
    case "nebula":
      return compose(rotationX(0.42), rotationY(t * 0.12));
    case "coin":
      return compose(
        translation(0, 0.04 * Math.sin(t * 0.9), 0),
        rotationX(-0.12 + 0.06 * Math.sin(t * 0.5)),
        rotationY(still ? -0.45 : t * 0.55 - 0.45),
        scaling(0.98),
      );
    case "flow":
      return compose(rotationY(-0.3 + 0.32 * Math.sin(t * 0.22)), rotationX(0.1), scaling(0.92));
    case "receipt":
      return compose(
        translation(0, 0.03 * Math.sin(t * 0.8), 0),
        rotationY(-0.25 + 0.4 * Math.sin(t * 0.3)),
        rotationZ(-0.07),
        rotationX(-0.12),
        scaling(0.95),
      );
    case "devices":
      return compose(rotationY(0.12 + 0.22 * Math.sin(t * 0.2)), rotationX(0.08), scaling(0.92));
  }
}

export interface Anchor {
  /** Scroll position at which the section is centred in the viewport. */
  readonly scroll: number;
  readonly stage: number;
}

/**
 * Stage for a scroll position. Each section holds its scene while it is roughly centred; the
 * morph happens in the middle half of the scroll between two sections.
 */
export function stageAt(scroll: number, anchors: readonly Anchor[]): number {
  if (anchors.length === 0) return 1;
  const first = anchors[0]!;
  if (scroll <= first.scroll) return first.stage;
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i]!, b = anchors[i + 1]!;
    if (scroll < b.scroll) {
      const f = (scroll - a.scroll) / Math.max(1, b.scroll - a.scroll);
      return a.stage + (b.stage - a.stage) * smoothstep(0.25, 0.75, f);
    }
  }
  return anchors[anchors.length - 1]!.stage;
}

/** Splits a fractional stage into the two scenes it morphs between and the progress. */
export function morphBetween(stage: number): { fromStage: number; toStage: number; t: number } {
  const clamped = Math.min(Math.max(0, stage), STAGES.length - 1);
  const fromStage = Math.min(Math.floor(clamped), STAGES.length - 1);
  const t = clamped - fromStage;
  if (t < 1e-4 || fromStage === STAGES.length - 1) return { fromStage, toStage: fromStage, t: 0 };
  return { fromStage, toStage: fromStage + 1, t };
}
