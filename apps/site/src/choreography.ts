// What the splats do on the page: which scene each section shows, how each scene moves while
// it rests, where on screen it sits, and how scrolling between sections scrubs the morph.
import { SCENE_IDS, type SceneId } from "./scenes/ids.ts";
import { compose, rotationX, rotationY, rotationZ, scaling, translation, type Mat4 } from "./splats/mat4.ts";
import { smoothstep } from "./splats/random.ts";

/** Scene shown at each stage; a section's data-stage picks one. Stage 0 is the intro. */
export const STAGES: readonly SceneId[] = ["nebula", "coin", "rings", "flow", "papers", "loop", "trio", "coin"];

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
        translation(0, 0.035 * Math.sin(t * 0.9), 0),
        rotationX(-0.16 + 0.06 * Math.sin(t * 0.5)),
        rotationY(still ? -0.5 : -0.5 + 0.55 * Math.sin(t * 0.42) + t * 0.18),
        rotationZ(0.04 * Math.sin(t * 0.33)),
      );
    case "rings":
      return compose(rotationX(0.18), rotationY(t * 0.22), rotationZ(0.1));
    case "flow":
      return compose(rotationY(-0.28 + 0.22 * Math.sin(t * 0.22)), rotationX(0.08), scaling(0.95));
    case "papers":
      return compose(rotationX(0.1), rotationY(t * 0.16), translation(0, 0.04 * Math.sin(t * 0.7), 0));
    case "loop":
      return compose(rotationX(0.25 + 0.05 * Math.sin(t * 0.3)), rotationY(0.3 * Math.sin(t * 0.18)));
    case "trio":
      return compose(rotationY(0.35 * Math.sin(t * 0.2)), rotationX(0.12), rotationZ(t * 0.05));
  }
}

export interface Anchor {
  /** Scroll position at which the section is centred in the viewport. */
  readonly scroll: number;
  readonly stage: number;
}

/**
 * Stage for a scroll position. Each section holds its scene while it is roughly centred; the
 * morph happens in the middle of the scroll between two sections.
 */
export function stageAt(scroll: number, anchors: readonly Anchor[]): number {
  if (anchors.length === 0) return 1;
  const first = anchors[0]!;
  if (scroll <= first.scroll) return first.stage;
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i]!, b = anchors[i + 1]!;
    if (scroll < b.scroll) {
      const f = (scroll - a.scroll) / Math.max(1, b.scroll - a.scroll);
      return a.stage + (b.stage - a.stage) * smoothstep(0.3, 0.7, f);
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

export interface Placement {
  /** Centre of the scene on screen, in CSS pixels. */
  readonly x: number;
  readonly y: number;
  /** Radius the scene's subject should cover on screen, in CSS pixels. */
  readonly radius: number;
}

export function mixPlacement(a: Placement, b: Placement, t: number): Placement {
  const e = t * t * (3 - 2 * t);
  return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, radius: a.radius + (b.radius - a.radius) * e };
}

/**
 * Camera distance and lens shift that put a subject of `subjectRadius` (world units) at the
 * placement on a viewport of `width` × `height` CSS pixels.
 */
export function cameraFor(
  placement: Placement,
  width: number,
  height: number,
  fovY: number,
  subjectRadius: number,
): { distance: number; shiftX: number; shiftY: number } {
  const focal = height / (2 * Math.tan(fovY / 2));
  const distance = Math.min(60, Math.max(2, (subjectRadius * focal) / Math.max(1, placement.radius)));
  return { distance, shiftX: (placement.x / width) * 2 - 1, shiftY: 1 - (placement.y / height) * 2 };
}
