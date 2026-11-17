// Scene ids in texture order. Kept apart from the generators so the page bundle stays small:
// only the worker imports the scenes themselves.
export const SCENE_IDS = ["nebula", "coin", "rings", "flow", "papers", "loop", "trio"] as const;

export type SceneId = (typeof SCENE_IDS)[number];
