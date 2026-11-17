// Every scene the page morphs between. All have the same splat count and the same ordering
// (left to right, then bottom to top), so splat i of one scene flies to splat i of the next.
import { sortCloud, SplatBuilder, type SplatCloud } from "../splats/cloud.ts";
import { apportion, createRandom, gaussian, mixColor } from "../splats/random.ts";
import { coinScene } from "./coin.ts";
import { loopScene, papersScene, ringsScene, trioScene } from "./ambient.ts";
import { flowScene } from "./flow.ts";
import { SCENE_IDS, type SceneId } from "./ids.ts";
import { palette } from "./palette.ts";

/** Keeps rare far outliers of the dust within the frame. */
const soft = (v: number) => 1.8 * Math.tanh(v / 1.8);

/** A warm spiral of dust the coin condenses out of when the page loads. */
export function nebulaScene(count: number, seed = 5): SplatCloud {
  const random = createRandom(seed);
  const builder = new SplatBuilder(count);
  const colors = [palette.glow1, palette.glow2, palette.glow3, palette.copperDark, palette.invest];
  const [armCount, dustCount] = apportion(count, [0.8, 0.2]) as [number, number];
  for (let i = 0; i < armCount; i++) {
    const arm = i % 3;
    const r = 0.15 + 2.1 * random() ** 1.6;
    const t = arm * ((Math.PI * 2) / 3) + r * 2.2 + gaussian(random) * 0.22;
    const s = 0.006 + 0.02 * random() ** 3;
    const c = colors[Math.floor(random() ** 1.5 * colors.length)]!;
    builder.push({
      position: [r * Math.cos(t), gaussian(random) * 0.06 * (1 + r), r * Math.sin(t)],
      scale: [s, s, s],
      color: mixColor(c, palette.cream, 0.3 * (1 - Math.min(r, 1))),
      opacity: 0.35 + 0.5 * random(),
    });
  }
  for (let i = 0; i < dustCount; i++) {
    const s = 0.02 + 0.06 * random() ** 2;
    builder.push({
      position: [soft(gaussian(random) * 1.1), soft(gaussian(random) * 0.5), soft(gaussian(random) * 1.1)],
      scale: [s, s, s],
      color: colors[Math.floor(random() * 3)]!,
      opacity: 0.03 + 0.08 * random(),
    });
  }
  return builder.build();
}

const BUILDERS: Record<SceneId, (count: number) => SplatCloud> = {
  nebula: nebulaScene,
  coin: coinScene,
  rings: ringsScene,
  flow: flowScene,
  papers: papersScene,
  loop: loopScene,
  trio: trioScene,
};

/** Order shared by every scene, so morphs sweep across the frame. */
export function morphOrder(x: number, y: number): number {
  return x * 0.85 + y * 0.35;
}

export function buildScene(id: SceneId, count: number): SplatCloud {
  return sortCloud(BUILDERS[id](count), morphOrder);
}

export function buildScenes(count: number): SplatCloud[] {
  return SCENE_IDS.map((id) => buildScene(id, count));
}
