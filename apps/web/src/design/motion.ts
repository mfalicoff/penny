import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * Motion tokens and helpers (docs/design/motion.md). The CSS tokens (`--pk-dur-*`, `--pk-ease-*`,
 * `--pk-nudge` and the rest, from design-kit/src/styles.css) drive everything CSS animates; these
 * mirror them for the few moments JavaScript drives (counting totals, the month slide, rows
 * leaving a list, dialogs closing). `motion.test.ts` keeps both equal to
 * contracts/design-baseline.json `tokens.motion`.
 */
export const DURATION = { quick: 150, standard: 250, emphasized: 400, linger: 1000 } as const;
export const EASING = { standard: "cubic-bezier(0.2, 0, 0, 1)", exit: "cubic-bezier(0.4, 0, 1, 1)", linear: "linear" } as const;
export const DISTANCE = { nudge: 8, shift: 24, shake: 6 } as const;
export const PRESS = 0.97;

export type DurationToken = keyof typeof DURATION;
export type DistanceToken = keyof typeof DISTANCE;

/**
 * `full`: everything moves. `reduced`: the person asked for reduced motion; movement becomes a
 * quick fade or happens at once. `off`: tests and card captures (`<html data-motion="off">`);
 * nothing animates at all, so nothing is ever captured mid-way.
 */
export type MotionMode = "full" | "reduced" | "off";

export function motionMode(): MotionMode {
  if (typeof document === "undefined") return "off";
  if (document.documentElement.dataset.motion === "off") return "off";
  if (typeof window.matchMedia !== "function") return "full";
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduced" : "full";
}

/** A duration token in milliseconds for the mode: reduced motion caps it at `quick` (except `linger`, a fade), off is 0. */
export function duration(token: DurationToken, mode: MotionMode = motionMode()): number {
  if (mode === "off") return 0;
  if (mode === "reduced" && token !== "linger") return Math.min(DURATION[token], DURATION.quick);
  return DURATION[token];
}

/** A distance token in pixels for the mode: 0 unless everything moves. */
export function distance(token: DistanceToken, mode: MotionMode = motionMode()): number {
  return mode === "full" ? DISTANCE[token] : 0;
}

/** `cubic-bezier(0.2, 0, 0, 1)` as a function of progress, for the JavaScript tweens. */
export function easeStandard(progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  // Solve x(s) = t for the curve parameter s by bisection, then return y(s).
  const curve = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 24; step += 1) {
    const middle = (low + high) / 2;
    if (curve(0.2, 0, middle) < t) low = middle;
    else high = middle;
  }
  return curve(0, 1, (low + high) / 2);
}

interface PlayOptions {
  duration: DurationToken;
  /** The `exit` easing, for something leaving the screen. */
  exit?: boolean;
  /** Keep the last frame after it ends (for an element about to be removed). */
  fill?: FillMode;
  /** Run with this mode instead of reading it (tests). */
  mode?: MotionMode;
}

/**
 * Plays keyframes with a token's duration and easing through the Web Animations API, or does
 * nothing when motion is off, the duration is 0, or the browser (or jsdom) has no `animate`.
 * Animations never block input: callers keep the element interactive throughout.
 */
export function play(element: Element | null | undefined, keyframes: Keyframe[], options: PlayOptions): Animation | null {
  const mode = options.mode ?? motionMode();
  const ms = duration(options.duration, mode);
  if (!element || ms === 0 || typeof element.animate !== "function") return null;
  return element.animate(keyframes, { duration: ms, easing: options.exit ? EASING.exit : EASING.standard, ...(options.fill ? { fill: options.fill } : {}) });
}

/** The person's reduced-motion setting, kept current. */
export function useMotionMode(): MotionMode {
  const [mode, setMode] = useState<MotionMode>(motionMode);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setMode(motionMode());
    };
    query.addEventListener("change", update);
    return () => {
      query.removeEventListener("change", update);
    };
  }, []);
  return mode;
}

/**
 * A total that counts from its old value to the new one over `emphasized` (Saving and month
 * changes), retargeting from wherever it is when the value changes again. Under reduced motion,
 * or with motion off, it shows the new value at once. Returns the value to draw and whether it is
 * counting, so the caller can hide the in-between numbers from assistive technology.
 */
export function useCountUp(target: number, from: number = target): { value: number; counting: boolean } {
  // `from`: where the first count starts (the recap counts up from 0 the first time it appears, MAZ-292).
  const [tween, setTween] = useState({ target, value: from });
  const shown = useRef(from);
  const moving = motionMode() === "full" && duration("emphasized") > 0;

  useEffect(() => {
    const from = shown.current;
    if (!moving || from === target || typeof requestAnimationFrame !== "function") {
      shown.current = target;
      return;
    }
    const ms = duration("emphasized");
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / ms);
      const next = progress >= 1 ? target : Math.round(from + (target - from) * easeStandard(progress));
      shown.current = next;
      setTween({ target, value: next });
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [target, moving]);

  // Until the first frame, a changed total still shows where it was; without motion, the new value at once.
  const value = moving ? tween.value : target;
  return { value, counting: value !== target };
}

/** Children of a period container that stay put: the month control itself, the page's glow and the recap banner (MAZ-292). */
const STAYS = ".month-bar__inline, .glow, .group-tools, .recap-banner";

/**
 * Month and period changes: when `period` changes, the content of the container behind `ref` (its
 * children, except the month control) fades in while sliding `shift` from the side it comes from
 * (an earlier period from the leading edge). Periods compare as strings ("2026-10"). While it
 * plays, the container carries `data-period-changing`, so rows that arrive with the new period
 * don't also run their own insert motion.
 */
export function usePeriodSlide(ref: RefObject<HTMLElement | null>, period: string, only?: string): void {
  const previous = useRef(period);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = period;
    const element = ref.current;
    if (!element || before === period) return;
    const mode = motionMode();
    const rtl = getComputedStyle(element).direction === "rtl";
    const fromLeading = period < before;
    const sign = (fromLeading ? -1 : 1) * (rtl ? -1 : 1);
    const offset = sign * distance("shift", mode);
    element.dataset.periodChanging = "";
    const targets = [...element.children].filter((child) => (only ? child.matches(only) : !child.matches(STAYS)));
    const animations = targets.flatMap((target) => play(target, [{ opacity: 0, transform: `translateX(${String(offset)}px)` }, { opacity: 1, transform: "none" }], { duration: "emphasized", mode }) ?? []);
    const done = () => {
      delete element.dataset.periodChanging;
    };
    if (animations.length) {
      Promise.all(animations.map((animation) => animation.finished)).then(done, done);
    } else {
      done();
    }
    return () => {
      for (const animation of animations) animation.cancel();
      done();
    };
  }, [ref, period, only]);
}

interface Leaving<T> {
  key: string;
  item: T;
  /** The listed row it followed, to put it back where it was while it leaves. */
  after: string | null;
}

export interface ListItem<T> {
  item: T;
  /** The item's own key. Render a leaving row under a different React key, so an item that comes back gets a fresh element. */
  key: string;
  /** The row has been removed and is playing its exit; render it inert. */
  leaving: boolean;
}

/**
 * Lists (docs/design/motion.md#3-lists): keeps a removed row on screen while it fades out and its
 * space closes, then drops it. `context` names what the list shows (the month, filters, a search):
 * when it changes, rows come and go at once, because that is a new list rather than an edit.
 * `animateInserts` is true while inserted rows should play their entrance (`data-animate-inserts`
 * on the list turns the CSS `@starting-style` on), i.e. after the first render and while
 * `context` holds still.
 */
export function useListMotion<T>(items: readonly T[], keyOf: (item: T) => string, context: string): { rows: ListItem<T>[]; animateInserts: boolean } {
  const [tracked, setTracked] = useState<{ items: readonly T[]; context: string; leaving: Leaving<T>[]; settled: boolean }>({ items, context, leaving: [], settled: false });
  let current = tracked;
  if (tracked.items !== items || tracked.context !== context) {
    // Derived during render (React's pattern for state that follows props), so a removed row never flickers away first.
    const changed = tracked.context !== context;
    const present = new Set(items.map(keyOf));
    let leaving = changed ? [] : tracked.leaving.filter((row) => !present.has(row.key));
    if (!changed && duration("standard") > 0) {
      let after: string | null = null;
      for (const item of tracked.items) {
        const key = keyOf(item);
        if (present.has(key)) after = key;
        else leaving = [...leaving.filter((row) => row.key !== key), { key, item, after }];
      }
    }
    current = { items, context, leaving, settled: !changed };
    setTracked(current);
  }

  const { leaving } = current;
  useEffect(() => {
    if (leaving.length === 0) return;
    const timer = window.setTimeout(() => {
      setTracked((state) => ({ ...state, leaving: state.leaving.filter((row) => !leaving.includes(row)) }));
    }, duration("quick") + duration("standard") + 50);
    return () => {
      window.clearTimeout(timer);
    };
  }, [leaving]);

  const rows: ListItem<T>[] = [];
  const anchored = (after: string | null) => leaving.filter((row) => row.after === after);
  for (const row of anchored(null)) rows.push({ item: row.item, key: row.key, leaving: true });
  for (const item of items) {
    const key = keyOf(item);
    rows.push({ item, key, leaving: false });
    for (const row of anchored(key)) rows.push({ item: row.item, key: row.key, leaving: true });
  }
  // A leaving row whose neighbour has gone too goes at the end, so it still finishes its exit.
  const placed = new Set(rows.map((row) => row.key));
  for (const row of leaving) if (!placed.has(row.key)) rows.push({ item: row.item, key: row.key, leaving: true });

  return { rows, animateInserts: current.settled };
}

/**
 * The exit of a removed row: it fades out (`quick`, exit easing), then its space closes
 * (`standard`). Pass as the `ref` of a row that `useListMotion` marks as leaving.
 */
export function exitRow(element: HTMLElement | null): void {
  if (!element || element.dataset.exiting !== undefined) return;
  element.dataset.exiting = "";
  const mode = motionMode();
  const height = element.getBoundingClientRect().height;
  const fade = play(element, [{ opacity: 1 }, { opacity: 0 }], { duration: "quick", exit: true, fill: "forwards", mode });
  const close = () => {
    if (!element.isConnected) return;
    // Under reduced motion the space closes at once, and so does a table row's: a row's height can't animate.
    if (mode !== "full" || element.tagName === "TR") {
      element.style.display = "none";
      return;
    }
    element.style.overflow = "hidden";
    play(element, [{ height: `${height}px`, opacity: 0 }, { height: "0px", opacity: 0, paddingBlock: "0px", marginBlock: "0px", borderWidth: "0px" }], { duration: "standard", exit: true, fill: "forwards", mode });
  };
  if (fade) {
    fade.finished.then(close, () => undefined);
  } else {
    close();
  }
}

/** The refused-field shake: three swings of `shake`, settling at rest, over two `quick`s. None under reduced motion. */
export function shake(element: Element | null | undefined): void {
  if (motionMode() !== "full" || !element || typeof element.animate !== "function") return;
  const a = DISTANCE.shake;
  element.animate([0, -a, a, -a, a, -a / 2, 0].map((x) => ({ transform: `translateX(${x}px)` })), { duration: DURATION.quick * 2, easing: EASING.standard });
}

/** Props of a row that has been removed and is playing its exit (motion.ts `useListMotion`). */
export const leavingProps = { inert: true, "aria-hidden": true, "data-leaving": "", ref: exitRow } as const;

/**
 * The saved row's highlight (`iphone-saved-toast`) shows while its toast does; when the toast
 * goes, the row keeps `activity-row--unsaving` for `linger` so the tint fades instead of
 * vanishing (docs/design/motion.md, Saving).
 */
export function useFadingHighlight(saved: string | null): string | null {
  const [state, setState] = useState<{ saved: string | null; fading: string | null }>({ saved, fading: null });
  let current = state;
  if (state.saved !== saved) {
    current = { saved, fading: state.saved ?? state.fading };
    setState(current);
  }
  const { fading } = current;
  useEffect(() => {
    if (!fading) return;
    const timer = window.setTimeout(() => {
      setState((value) => (value.fading === fading ? { ...value, fading: null } : value));
    }, duration("linger"));
    return () => {
      window.clearTimeout(timer);
    };
  }, [fading]);
  return fading === saved ? null : fading;
}

