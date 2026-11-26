import "./styles.css";
import { startClips } from "./clips.ts";
import { cameraFor, mixPlacement, morphBetween, sceneIndex, sceneModel, stageAt, STAGES, type Anchor, type Placement } from "./choreography.ts";
import { SCENE_IDS } from "./scenes/ids.ts";
import { lookAt, perspective } from "./splats/mat4.ts";
import type { WorkerReply, WorkerRequest } from "./splats/protocol.ts";
import { SplatRenderer } from "./splats/renderer.ts";

const INTRO_SECONDS = 3;
const FOV = (30 * Math.PI) / 180;
/** Radius the scenes are built to fit in, in world units. */
const SUBJECT_RADIUS = 1.35;

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const canvas = document.querySelector<HTMLCanvasElement>("#splats");

function splatBudget(): number {
  // ?splats=N overrides the budget, for profiling on a given device.
  const requested = Number(new URLSearchParams(location.search).get("splats"));
  if (Number.isInteger(requested) && requested >= 1000 && requested <= 400_000) return requested;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const small = Math.min(screen.width, screen.height) < 700;
  return small || memory < 4 ? 70_000 : 160_000;
}

/** Where a section wants its scene: its [data-splat] element, scaled by data-fit. */
function placementOf(section: HTMLElement): Placement {
  const target = section.querySelector<HTMLElement>("[data-splat]") ?? section;
  const rect = target.getBoundingClientRect();
  const fit = Number(target.dataset.fit ?? 1);
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, radius: (Math.min(rect.width, rect.height) / 2) * fit };
}

function start(canvas: HTMLCanvasElement): void {
  let renderer: SplatRenderer | undefined;
  try {
    renderer = SplatRenderer.create(canvas);
  } catch (error) {
    console.warn("Splats unavailable", error);
  }
  if (!renderer) {
    document.documentElement.classList.add("no-splats");
    return;
  }
  const splats = renderer;

  const worker = new Worker(new URL("./splats/worker.ts", import.meta.url), { type: "module" });
  const send = (request: WorkerRequest, transfer: Transferable[] = []) => worker.postMessage(request, { transfer });
  let sorting = false;
  let spare: Uint32Array = new Uint32Array(0);
  let readyAt = -1;

  worker.addEventListener("message", (event: MessageEvent<WorkerReply>) => {
    const reply = event.data;
    if (reply.type === "layout") {
      splats.allocate(reply.layout);
    } else if (reply.type === "scene") {
      splats.upload(reply.packed);
      if (readyAt < 0 && splats.readyScenes >= 2) {
        readyAt = performance.now();
        document.documentElement.classList.add("splats-ready");
      }
    } else {
      if (reply.order.length === splats.splatCount) splats.setOrder(reply.order);
      spare = reply.order;
      sorting = false;
    }
  });
  worker.addEventListener("error", () => document.documentElement.classList.add("no-splats"));
  send({ type: "init", count: splatBudget() });

  // Sections pick their scene with data-stage, and where it sits with a [data-splat] element.
  let sections: { stage: number; el: HTMLElement }[] = [];
  let anchors: Anchor[] = [];
  const measure = () => {
    sections = [...document.querySelectorAll<HTMLElement>("[data-stage]")].map((el) => ({ el, stage: Number(el.dataset.stage) }));
    anchors = sections
      .map(({ el, stage }) => {
        const target = el.querySelector<HTMLElement>("[data-splat]") ?? el;
        const rect = target.getBoundingClientRect();
        const centre = rect.top + window.scrollY + rect.height / 2;
        return { scroll: Math.max(0, centre - window.innerHeight / 2), stage };
      })
      .sort((a, b) => a.scroll - b.scroll);
  };
  const placementFor = (stage: number): Placement => {
    const section = sections.find((s) => s.stage === Math.max(1, stage)) ?? sections[0];
    return section ? placementOf(section.el) : { x: window.innerWidth / 2, y: window.innerHeight / 2, radius: 200 };
  };

  // Full device resolution, stepped down while frames are slow.
  const maxScale = Math.min(window.devicePixelRatio || 1, 2);
  let scale = maxScale;
  const resize = () => {
    canvas.width = Math.round(canvas.clientWidth * scale);
    canvas.height = Math.round(canvas.clientHeight * scale);
    measure();
  };
  new ResizeObserver(resize).observe(document.body);
  window.addEventListener("resize", resize);
  resize();

  let pointerX = 0, pointerY = 0, lookX = 0, lookY = 0;
  window.addEventListener("pointermove", (e) => {
    pointerX = (e.clientX / window.innerWidth) * 2 - 1;
    pointerY = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  let stage = 0;
  let introDone = false;
  let last = performance.now();
  let slowFrames = 0, fastFrames = 0;

  const tick = (now: number) => {
    requestAnimationFrame(tick);
    const rawDt = (now - last) / 1000;
    const dt = Math.min(0.25, rawDt);
    last = now;
    if (readyAt < 0) return;

    // Adaptive resolution: a second of slow frames drops it, a few seconds of fast ones restore it.
    if (rawDt > 1 / 40) slowFrames++; else slowFrames = Math.max(0, slowFrames - 1);
    if (rawDt < 1 / 70) fastFrames++; else fastFrames = 0;
    if (slowFrames > 45 && scale > 1) {
      scale = Math.max(1, scale - 0.25);
      slowFrames = 0;
      resize();
    } else if (fastFrames > 240 && scale < maxScale) {
      scale = Math.min(maxScale, scale + 0.25);
      fastFrames = 0;
      resize();
    }

    const still = reducedMotion.matches;
    const time = (now - readyAt) / 1000;
    const loadedStages = STAGES.findIndex((id) => SCENE_IDS.indexOf(id) >= splats.readyScenes);
    const maxStage = loadedStages < 0 ? STAGES.length - 1 : loadedStages - 1;
    const target = Math.min(stageAt(window.scrollY, anchors), maxStage);
    if (still) {
      stage = Math.round(target);
    } else if (!introDone && target >= 1) {
      // The intro: the nebula condenses into the coin, whatever the scroll position.
      const p = Math.min(1, time / INTRO_SECONDS);
      stage = Math.min(target, p * p * (3 - 2 * p));
      introDone = p >= 1;
    } else {
      stage += (target - stage) * (1 - Math.exp(-dt * 5));
      if (Math.abs(target - stage) < 1e-4) stage = target;
    }

    const { fromStage, toStage, t } = morphBetween(stage);
    const from = sceneIndex(fromStage);
    const to = sceneIndex(toStage);
    const modelA = sceneModel(SCENE_IDS[from]!, time, still);
    const modelB = sceneModel(SCENE_IDS[to]!, time, still);

    // The camera follows the sections' [data-splat] boxes, so the scene stays attached to them.
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const placement = mixPlacement(placementFor(fromStage), placementFor(toStage), t);
    const { distance, shiftX, shiftY } = cameraFor(placement, width, height, FOV, SUBJECT_RADIUS);
    const proj = perspective(FOV, width / Math.max(1, height), 0.1, 200, shiftX, shiftY);
    const ease = 1 - Math.exp(-dt * 2.5);
    lookX += ((still ? 0 : pointerX) - lookX) * ease;
    lookY += ((still ? 0 : pointerY) - lookY) * ease;
    const yaw = lookX * 0.14, pitch = -lookY * 0.08;
    const eye: [number, number, number] = [
      distance * Math.sin(yaw) * Math.cos(pitch),
      distance * Math.sin(pitch),
      distance * Math.cos(yaw) * Math.cos(pitch),
    ];
    const view = lookAt(eye, [0, 0, 0]);

    if (!sorting) {
      sorting = true;
      const order = spare;
      spare = new Uint32Array(0);
      send({ type: "sort", from, to, t, modelA, modelB, view, order }, order.byteLength ? [order.buffer] : []);
    }
    canvas.dataset.debugStage = stage.toFixed(3);
    splats.render({ from, to, t, time, modelA, modelB, view, proj, eye, opacity: 1 });
  };
  requestAnimationFrame(tick);
}

if (canvas) start(canvas);
startClips(reducedMotion);

document.querySelector("#year")?.replaceChildren(String(new Date().getFullYear()));
