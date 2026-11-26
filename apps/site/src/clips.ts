/**
 * Plays the short clips of the apps in use (rendered by apps/site/video) inside device frames.
 *
 * A frame opts in with `data-clip="<id>"`, and its captions are a `[data-clip-captions="<id>"]`
 * list in the page. The frame keeps its still `<img>`: the clip is laid over it only when the
 * section comes near, and only when motion and data allow it. Reduced motion, Save-Data, no
 * JavaScript, a browser that plays neither format, or a clip that isn't rendered yet (the iOS
 * ones, until they're recorded) all keep the still.
 */
const FILES = import.meta.glob<string>("./assets/clips/*", { eager: true, query: "?url", import: "default" });

/** Windows this wide get the full-size clip; narrower ones the half-size one. */
const FULL_SIZE = "(min-width: 701px)";
const AV1 = 'video/webm; codecs="av01.0.08M.08"';
const AV1_SMALL = 'video/webm; codecs="av01.0.04M.08"';
const H264 = 'video/mp4; codecs="avc1.640028"';

export interface ClipFiles {
  webm?: string;
  mp4?: string;
  smallWebm?: string;
  smallMp4?: string;
  poster?: string;
}

/** The rendered files for `id`, from the URLs Vite gives the files in src/assets/clips. */
export function clipFiles(id: string, files: Record<string, string> = FILES): ClipFiles {
  const file = (name: string) => files[`./assets/clips/${name}`];
  return {
    webm: file(`${id}.webm`),
    mp4: file(`${id}.mp4`),
    smallWebm: file(`${id}-720.webm`),
    smallMp4: file(`${id}-720.mp4`),
    poster: file(`${id}-poster.webp`),
  };
}

/** Whether the visitor asked for less data: Save-Data, or `prefers-reduced-data`. */
function savesData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true || window.matchMedia("(prefers-reduced-data: reduce)").matches;
}

/** The `<source>`s, best first. Browsers that ignore `media` take the full-size clip. */
export function sourcesFor(files: ClipFiles): { src: string; type: string; media?: string }[] {
  const hasSmall = Boolean(files.smallWebm || files.smallMp4);
  const media = hasSmall ? FULL_SIZE : undefined;
  const sources: { src: string; type: string; media?: string }[] = [];
  if (files.webm) sources.push({ src: files.webm, type: AV1, media });
  if (files.mp4) sources.push({ src: files.mp4, type: H264, media });
  if (files.smallWebm) sources.push({ src: files.smallWebm, type: AV1_SMALL });
  if (files.smallMp4) sources.push({ src: files.smallMp4, type: H264 });
  return sources;
}

const PAUSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>';
const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>';

interface Player {
  video: HTMLVideoElement;
  /** False once the visitor pauses it: scrolling back doesn't restart it. */
  wanted: boolean;
  visible: boolean;
}

function attach(figure: HTMLElement, files: ClipFiles, captions: HTMLElement | null): Player | null {
  const img = figure.querySelector("img");
  if (!img) return null;

  const frame = document.createElement("div");
  frame.className = "clip-frame";
  img.replaceWith(frame);
  frame.append(img);

  const video = document.createElement("video");
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "none";
  video.setAttribute("aria-label", img.alt);
  if (files.poster) video.poster = files.poster;
  for (const { src, type, media } of sourcesFor(files)) {
    const source = document.createElement("source");
    source.src = src;
    source.type = type;
    if (media) source.media = media;
    video.append(source);
  }
  video.addEventListener("playing", () => frame.classList.add("is-playing"), { once: true });
  frame.append(video);

  const player: Player = { video, wanted: true, visible: false };
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "clip-toggle";
  const label = () => {
    toggle.setAttribute("aria-label", player.wanted ? "Pause the animation" : "Play the animation");
    toggle.innerHTML = player.wanted ? PAUSE_ICON : PLAY_ICON;
  };
  label();
  toggle.addEventListener("click", () => {
    player.wanted = !player.wanted;
    label();
    update(player);
  });
  frame.append(toggle);

  // Emphasise the caption for the current beat: the last one whose time has come.
  const items = captions ? [...captions.querySelectorAll<HTMLElement>("[data-at]")] : [];
  if (captions && items.length > 0) {
    captions.classList.add("is-synced");
    video.addEventListener("timeupdate", () => {
      let current = items[0];
      for (const item of items) if (Number(item.dataset.at) <= video.currentTime) current = item;
      for (const item of items) item.classList.toggle("is-current", item === current);
    });
  }
  video.load();
  return player;
}

function update(player: Player): void {
  if (player.wanted && player.visible && !document.hidden) void player.video.play().catch(() => undefined);
  else player.video.pause();
}

/** Starts every rendered clip on the page; see the module comment for when it doesn't. */
export function startClips(reducedMotion: MediaQueryList): void {
  const figures = [...document.querySelectorAll<HTMLElement>("[data-clip]")];
  const ready = figures.flatMap((figure) => {
    const id = figure.dataset.clip ?? "";
    const files = clipFiles(id);
    if (!files.webm && !files.mp4) return [];
    // Captions describe the clip, so they show only once it exists, with or without motion.
    const captions = document.querySelector<HTMLElement>(`[data-clip-captions="${id}"]`);
    if (captions) captions.hidden = false;
    return [{ figure, files, captions }];
  });
  if (ready.length === 0 || reducedMotion.matches || savesData()) return;

  const probe = document.createElement("video");
  if (!probe.canPlayType(AV1) && !probe.canPlayType(H264)) return;

  const players: Player[] = [];
  const playing = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const player = players.find((candidate) => candidate.video === entry.target);
        if (!player) continue;
        player.visible = entry.isIntersecting;
        update(player);
      }
    },
    { threshold: 0.25 },
  );
  // Load a clip about a screen before its section arrives, so it's ready when it's seen.
  const nearby = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        nearby.unobserve(entry.target);
        const found = ready.find(({ figure }) => figure === entry.target);
        const player = found && attach(found.figure, found.files, found.captions);
        if (!player) continue;
        players.push(player);
        playing.observe(player.video);
      }
    },
    { rootMargin: "100% 0px" },
  );
  for (const { figure } of ready) nearby.observe(figure);

  document.addEventListener("visibilitychange", () => players.forEach(update));
  // Reduced motion switched on while the page is open: stop, and go back to the stills.
  reducedMotion.addEventListener("change", () => {
    if (!reducedMotion.matches) return;
    nearby.disconnect();
    playing.disconnect();
    for (const player of players) {
      player.video.pause();
      player.video.closest(".clip-frame")?.classList.add("is-stopped");
    }
  });
}
