// Puts one splat scene on the page, in its own canvas inside a host element: the coin in the
// hero, the money-flow ribbons behind the showcase. Each scene scrolls with its section, renders
// at the device's resolution, and only runs while it's on screen.
import type { SceneId } from "../scenes/ids.ts";
import { compose, lookAt, perspective, rotationX, rotationY, rotationZ, translation, type Mat4 } from "./mat4.ts";
import type { WorkerReply, WorkerRequest } from "./protocol.ts";
import { SplatRenderer } from "./renderer.ts";

const FOV = (30 * Math.PI) / 180;

export interface SceneSetup {
  /** Splats on a large screen, and on phones or devices with little memory. */
  readonly splats: readonly [large: number, small: number];
  /** World units the camera fits into the host: the coin's radius, or the ribbons' half width. */
  readonly extent: number;
  /** How much of the host's half-size that extent covers, along `axis`. */
  readonly fill: number;
  readonly axis: "min" | "width";
  /** Light that adds up (the ribbons) rather than a solid object: no back-to-front sorting. */
  readonly additive?: boolean;
  /** The scene's resting motion at `time` seconds (a fixed pose when `still`). */
  model(time: number, still: boolean): Mat4;
}

export const SCENES: Record<SceneId, SceneSetup> = {
  coin: {
    splats: [64_000, 26_000],
    extent: 1,
    fill: 0.46,
    axis: "min",
    // Sways to either side, so the leaf always faces the visitor.
    model: (t, still) =>
      still
        ? compose(rotationX(-0.12), rotationY(-0.32))
        : compose(
            translation(0, 0.03 * Math.sin(t * 0.9), 0),
            rotationX(-0.12 + 0.05 * Math.sin(t * 0.5)),
            rotationY(-0.3 + 0.42 * Math.sin(t * 0.35)),
            rotationZ(0.03 * Math.sin(t * 0.33)),
          ),
  },
  flow: {
    splats: [40_000, 16_000],
    extent: 2.4,
    fill: 1,
    axis: "width",
    additive: true,
    model: (t, still) => (still ? rotationY(-0.1) : compose(rotationY(-0.1 + 0.05 * Math.sin(t * 0.2)), rotationX(0.04 * Math.sin(t * 0.17)))),
  },
};

/** Splats for a scene on this device. `?splats=N` sets the coin to N and the other scenes in proportion. */
export function splatCount(setup: SceneSetup, small: boolean, requested?: number): number {
  const [large, compact] = setup.splats;
  if (requested && Number.isInteger(requested) && requested >= 1000 && requested <= 400_000) return Math.round((requested / 64_000) * large);
  return small ? compact : large;
}

/** Distance from the camera that fits the scene's extent into a host of `width` × `height` CSS px. */
export function cameraDistance(setup: SceneSetup, width: number, height: number): number {
  const focal = height / (2 * Math.tan(FOV / 2));
  const pixels = (setup.axis === "width" ? width / 2 : Math.min(width, height) / 2) * setup.fill;
  return Math.min(80, Math.max(1.5, (setup.extent * focal) / Math.max(1, pixels)));
}

function deviceIsSmall(): boolean {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return Math.min(screen.width, screen.height) < 700 || memory < 4;
}

/** Mounts `scene` into `host`. Returns false when WebGL2 isn't available. */
export function mountScene(host: HTMLElement, scene: SceneId, reducedMotion: MediaQueryList): boolean {
  const setup = SCENES[scene];
  const canvas = document.createElement("canvas");
  canvas.className = "splats";
  canvas.setAttribute("aria-hidden", "true");
  let renderer: SplatRenderer | undefined;
  try {
    renderer = SplatRenderer.create(canvas);
  } catch (error) {
    console.warn("Splats unavailable", error);
  }
  if (!renderer) return false;
  const splats = renderer;
  host.append(canvas);

  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  const send = (request: WorkerRequest, transfer: Transferable[] = []) => worker.postMessage(request, { transfer });
  const requested = Number(new URLSearchParams(location.search).get("splats")) || undefined;
  send({ type: "init", scene, count: splatCount(setup, deviceIsSmall(), requested) });

  let sorting = false;
  let sorted = false;
  let spare: Uint32Array = new Uint32Array(0);
  let startedAt = -1;
  let visible = false;
  let frame = 0;

  // Always the device's resolution (up to 2×): fewer splats on small devices, never a blurry canvas.
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const resize = () => {
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * scale));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * scale));
    draw(performance.now());
  };

  let pointerX = 0, pointerY = 0, lookX = 0, lookY = 0;
  window.addEventListener("pointermove", (event) => {
    pointerX = (event.clientX / window.innerWidth) * 2 - 1;
    pointerY = (event.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  let last = performance.now();
  function draw(now: number): void {
    if (!splats.ready || canvas.width < 2) return;
    const still = reducedMotion.matches;
    const time = (now - startedAt) / 1000;
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    const ease = still ? 1 : 1 - Math.exp(-dt * 2.5);
    lookX += ((still ? 0 : pointerX) - lookX) * ease;
    lookY += ((still ? 0 : pointerY) - lookY) * ease;

    const width = canvas.clientWidth, height = canvas.clientHeight;
    const distance = cameraDistance(setup, width, height);
    const yaw = lookX * 0.1, pitch = -lookY * 0.06;
    const eye: [number, number, number] = [
      distance * Math.sin(yaw) * Math.cos(pitch),
      distance * Math.sin(pitch),
      distance * Math.cos(yaw) * Math.cos(pitch),
    ];
    const view = lookAt(eye, [0, 0, 0]);
    const proj = perspective(FOV, width / Math.max(1, height), 0.1, 200);
    const model = setup.model(time, still);
    if (!sorting && !setup.additive) {
      sorting = true;
      const order = spare;
      spare = new Uint32Array(0);
      send({ type: "sort", model, view, order }, order.byteLength ? [order.buffer] : []);
    }
    splats.render({ time, model, view, proj, eye, opacity: 1, additive: setup.additive });
  }

  const loop = (now: number) => {
    frame = 0;
    if (!visible || document.hidden || reducedMotion.matches) return;
    draw(now);
    frame = requestAnimationFrame(loop);
  };
  const run = () => {
    if (frame || !splats.ready) return;
    if (reducedMotion.matches) draw(performance.now());
    else frame = requestAnimationFrame(loop);
  };

  worker.addEventListener("message", (event: MessageEvent<WorkerReply>) => {
    const reply = event.data;
    if (reply.type === "scene") {
      splats.upload(reply.layout, reply.packed);
      startedAt = performance.now();
      host.classList.add("splats-ready");
      resize();
      run();
    } else {
      if (reply.order.length === splats.splatCount) splats.setOrder(reply.order);
      spare = reply.order;
      sorting = false;
      // A still scene draws once more with its first back-to-front order.
      if (!sorted && reducedMotion.matches) draw(performance.now());
      sorted = true;
    }
  });
  worker.addEventListener("error", () => host.classList.add("no-splats"));

  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(
    ([entry]) => {
      visible = entry?.isIntersecting ?? false;
      if (visible) run();
    },
    { rootMargin: "120px 0px" },
  ).observe(host);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && visible) run();
  });
  reducedMotion.addEventListener("change", () => {
    if (!reducedMotion.matches) run();
    else draw(performance.now());
  });
  return true;
}
