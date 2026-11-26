// Scene ids. Kept apart from the generators so the page bundle stays small: only the workers
// import the scenes themselves.
export const SCENE_IDS = ["coin", "flow"] as const;

export type SceneId = (typeof SCENE_IDS)[number];
