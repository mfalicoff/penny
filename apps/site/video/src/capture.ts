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
