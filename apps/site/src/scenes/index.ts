// The page's two splat scenes: the coin in the hero, the money-flow ribbons behind the showcase.
import type { SplatCloud } from "../splats/cloud.ts";
import { coinScene } from "./coin.ts";
import { flowScene } from "./flow.ts";
import type { SceneId } from "./ids.ts";

const BUILDERS: Record<SceneId, (count: number) => SplatCloud> = {
  coin: coinScene,
  flow: flowScene,
};

export function buildScene(id: SceneId, count: number): SplatCloud {
  return BUILDERS[id](count);
}
