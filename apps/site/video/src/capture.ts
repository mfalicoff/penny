/** A box in CSS pixels of the captured screen (points on iOS). */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptureEvent {
  /** Seconds from the start of the recording. */
  t: number;
  /** The element involved, when there is one. */
  box?: Box;
}

/**
 * What a capture script writes to captures/<clip>/capture.json, next to its frames. The web
 * capture (capture/web.ts) and the iOS one share this format, so every composition reads the
 * same thing.
 */
export interface Capture {
  /** The screen in CSS pixels (points on iOS). */
  width: number;
  height: number;
  /** Device pixels per CSS pixel in the frames. */
  scale: number;
  /** The clip's length in seconds. */
  duration: number;
  /** One image per change on screen, each shown from `t` until the next. */
  frames: { t: number; file: string }[];
  events: Record<string, CaptureEvent>;
}

/** The frame on screen at `t` seconds. */
export function frameAt(capture: Capture, t: number): string {
  let file = capture.frames[0]?.file ?? "";
  for (const frame of capture.frames) {
    if (frame.t > t) break;
    file = frame.file;
  }
  return file;
}

/** A named moment of the capture, with its element's box. */
export function event(capture: Capture, name: string): { t: number; box: Box } {
  const found = capture.events[name];
  if (!found?.box) throw new Error(`The capture has no "${name}" event with a box; capture it again`);
  return { t: found.t, box: found.box };
}

/**
 * The capture played at another pace: `keys` pair capture times with clip times (both seconds,
 * increasing), and the time between keys is stretched or squeezed linearly. The iOS clips use it
 * to fit the simulator's real pace (UI tests tap slower than a person) to the storyboard's beats.
 * Frames and events move with it; the result lasts until the last key's clip time.
 */
export function retime(capture: Capture, keys: readonly (readonly [capture: number, clip: number])[]): Capture {
  if (keys.length < 2) throw new Error("retime() needs at least two keys");
  for (let index = 1; index < keys.length; index++) {
    const [previous, key] = [keys[index - 1]!, keys[index]!];
    if (key[0] <= previous[0] || key[1] <= previous[1]) throw new Error(`retime() keys must increase (key ${index})`);
  }
  const map = (t: number): number => {
    let index = 1;
    while (index < keys.length - 1 && t > keys[index]![0]) index++;
    const [from, to] = [keys[index - 1]!, keys[index]!];
    return from[1] + ((t - from[0]) * (to[1] - from[1])) / (to[0] - from[0]);
  };
  const last = keys[keys.length - 1]!;
  const events: Capture["events"] = {};
  for (const [name, found] of Object.entries(capture.events)) events[name] = { ...found, t: map(found.t) };
  return {
    ...capture,
    duration: last[1],
    frames: capture.frames.filter((frame) => frame.t <= last[0]).map((frame) => ({ ...frame, t: map(frame.t) })),
    events,
  };
}

/**
 * `retime` for recordings of UI tests, which wait between steps: each beat pairs a step's
 * capture time with its clip time, and the `settle` seconds after each step (the sheet rising,
 * a number counting) play at real speed. Only the waits in between are squeezed.
 */
export function paced(capture: Capture, beats: readonly (readonly [capture: number, clip: number])[], settle = 0.5): Capture {
  const keys: (readonly [number, number])[] = [];
  beats.forEach((beat, index) => {
    keys.push(beat);
    const next = beats[index + 1];
    if (!next) return;
    const real = Math.min(settle, 0.6 * (next[1] - beat[1]), 0.9 * (next[0] - beat[0]));
    if (real > 0.02) keys.push([beat[0] + real, beat[1] + real]);
  });
  return retime(capture, keys);
}

/** When a named moment of the capture happened, in seconds (boxes optional). */
export function timeOf(capture: Capture, name: string): number {
  const found = capture.events[name];
  if (!found) throw new Error(`The capture has no "${name}" event; capture it again`);
  return found.t;
}
