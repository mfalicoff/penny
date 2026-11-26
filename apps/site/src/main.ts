import "./styles.css";
import { startClips } from "./clips.ts";
import type { SceneId } from "./scenes/ids.ts";
import { mountScene } from "./splats/stage.ts";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// The two splat scenes: `data-scene="coin"` in the hero, `data-scene="flow"` behind the showcase.
for (const host of document.querySelectorAll<HTMLElement>("[data-scene]")) {
  if (!mountScene(host, host.dataset.scene as SceneId, reducedMotion)) host.classList.add("no-splats");
}
startClips(reducedMotion);

document.querySelector("#year")?.replaceChildren(String(new Date().getFullYear()));
