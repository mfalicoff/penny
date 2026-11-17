import "./styles.css";
import { morphBetween, sceneIndex, sceneModel, stageAt, STAGES, type Anchor } from "./choreography.ts";
import { SCENE_IDS } from "./scenes/ids.ts";
import { lookAt, perspective } from "./splats/mat4.ts";
import type { WorkerReply, WorkerRequest } from "./splats/protocol.ts";
import { SplatRenderer } from "./splats/renderer.ts";

const INTRO_SECONDS = 3.2;
const FOV = (34 * Math.PI) / 180;
/** Radius the scenes are built to fit in. */
const SUBJECT_RADIUS = 1.35;

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const canvas = document.querySelector<HTMLCanvasElement>("#splats");

function splatBudget(): number {
  // ?splats=N overrides the budget, for profiling on a given device.
  const requested = Number(new URLSearchParams(location.search).get("splats"));
  if (Number.isInteger(requested) && requested >= 1000 && requested <= 400_000) return requested;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const small = Math.min(screen.width, screen.height) < 700;
  return small || memory < 4 ? 60_000 : 120_000;
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
  let frame = 0;

  worker.addEventListener("message", (event: MessageEvent<WorkerReply>) => {
    const reply = event.data;
    if (reply.type === "scenes") {
      splats.upload(reply.packed);
      readyAt = performance.now();
      document.documentElement.classList.add("splats-ready");
    } else {
      splats.setOrder(reply.order);
      spare = reply.order;
      sorting = false;
    }
  });
  worker.addEventListener("error", () => document.documentElement.classList.add("no-splats"));
  send({ type: "init", count: splatBudget() });

  // Sections pick their scene with data-stage; recomputed when the layout changes.
  let anchors: Anchor[] = [];
  // On wide screens a section owns the scene while it is centred; on phones, where the scene
  // sits above the text, while its top (the empty space over its heading) is on screen.
  const measure = () => {
    const wide = window.innerWidth >= 900;
    anchors = [...document.querySelectorAll<HTMLElement>("[data-stage]")]
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const top = rect.top + window.scrollY;
        const scroll = wide ? top + Math.min(rect.height, window.innerHeight * 1.4) / 2 - window.innerHeight / 2 : top;
        return { scroll: Math.max(0, scroll), stage: Number(el.dataset.stage) };
      })
      .sort((a, b) => a.scroll - b.scroll);
  };

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    measure();
  };
  new ResizeObserver(resize).observe(document.body);
  resize();

  let pointerX = 0, pointerY = 0, lookX = 0, lookY = 0;
  window.addEventListener("pointermove", (e) => {
    pointerX = (e.clientX / window.innerWidth) * 2 - 1;
    pointerY = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  let stage = 0;
  let introDone = false;
  let last = performance.now();

  const tick = (now: number) => {
    requestAnimationFrame(tick);
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (!splats.ready) return;

    const still = reducedMotion.matches;
    const time = (now - readyAt) / 1000;
    const target = stageAt(window.scrollY, anchors);
    if (still) {
      stage = Math.round(target);
    } else if (!introDone && target >= 1) {
      // The intro: the nebula condenses into the coin, whatever the scroll position.
      const p = Math.min(1, time / INTRO_SECONDS);
      stage = Math.min(target, p * p * (3 - 2 * p));
      introDone = p >= 1;
    } else {
      stage += (target - stage) * (1 - Math.exp(-dt * 4));
      if (Math.abs(target - stage) < 1e-4) stage = target;
    }

    const { fromStage, toStage, t } = morphBetween(stage);
    const from = sceneIndex(fromStage);
    const to = sceneIndex(toStage);
    const modelA = sceneModel(SCENE_IDS[from]!, time, still);
    const modelB = sceneModel(SCENE_IDS[to]!, time, still);

    // Camera: far enough to fit the subject; on wide screens it sits right of the text.
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const aspect = width / Math.max(1, height);
    const wide = width >= 900;
    const tanV = Math.tan(FOV / 2), tanH = tanV * aspect;
    const distance = Math.max(SUBJECT_RADIUS / (tanH * (wide ? 0.5 : 0.92)), SUBJECT_RADIUS / (tanV * (wide ? 0.82 : 0.5)));
    const proj = perspective(FOV, aspect, 0.1, 60, wide ? 0.44 : 0, wide ? 0 : 0.4);
    const ease = 1 - Math.exp(-dt * 2.5);
    lookX += ((still ? 0 : pointerX) - lookX) * ease;
    lookY += ((still ? 0 : pointerY) - lookY) * ease;
    const yaw = lookX * 0.16, pitch = lookY * 0.1;
    const view = lookAt([distance * Math.sin(yaw) * Math.cos(pitch), distance * Math.sin(pitch), distance * Math.cos(yaw) * Math.cos(pitch)], [0, 0, 0]);

    if (!sorting) {
      sorting = true;
      const order = spare;
      spare = new Uint32Array(0);
      send({ type: "sort", frame: frame++, from, to, t, modelA, modelB, view, order }, order.byteLength ? [order.buffer] : []);
    }
    canvas.dataset.stage = stage.toFixed(3);
    splats.render({ from, to, t, time, modelA, modelB, view, proj, opacity: 1 });
  };
  requestAnimationFrame(tick);
}

if (canvas && STAGES.length > 0) start(canvas);

document.querySelector("#year")?.replaceChildren(String(new Date().getFullYear()));
