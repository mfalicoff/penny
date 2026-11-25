import { z } from "zod";
import type { TelemetryChoices } from "./consent";

/**
 * Opt-in browser telemetry (MAZ-129). Nothing is sent unless all of these hold:
 *
 * - the server offers it (`/api/info` `telemetry.web`, set by the operator's
 *   `ClientTelemetry__FaroUrl`);
 * - the person is signed in, outside the demo;
 * - they chose to share at least one kind (./consent.ts).
 *
 * Reports go to the API (`POST /api/telemetry/faro`) with the session cookie, never to a
 * collector: the API checks, scrubs and forwards them on its private network. The Faro SDK
 * is downloaded only once telemetry is wanted. Errors before sign-in are not reported.
 */
export interface TelemetryState {
  /** Signed in, and not the demo. */
  active: boolean;
  serverWeb: boolean;
  serverReplay: boolean;
  choices: TelemetryChoices;
}

export const OFF: TelemetryState = {
  active: false,
  serverWeb: false,
  serverReplay: false,
  choices: { errors: false, performance: false, replay: false, decided: false },
};

let state: TelemetryState = OFF;

/** The state Faro's beforeSend reads for every item. */
export function telemetryState(): TelemetryState {
  return state;
}

/** Whether any report may be sent now. */
export function wantsTelemetry(next: TelemetryState): boolean {
  const { errors, performance, replay } = next.choices;
  return (
    next.active &&
    next.serverWeb &&
    (errors || performance || (replay && next.serverReplay))
  );
}

/** Whether Session Replay may record now. */
export function wantsReplay(next: TelemetryState): boolean {
  return (
    next.active && next.serverWeb && next.serverReplay && next.choices.replay
  );
}

async function loadVersion(fetcher: typeof fetch): Promise<string> {
  try {
    const response = await fetcher("/version.json", {
      cache: "no-store",
      credentials: "omit",
    });
    if (!response.ok) return "unknown";
    const { version } = z
      .object({ version: z.string().min(1).max(100) })
      .parse(await response.json());
    return version;
  } catch {
    return "unknown";
  }
}

interface Running {
  pause: () => void;
  resume: () => void;
  setReplay: (on: boolean) => Promise<void>;
}

let running: Promise<Running | null> | null = null;

/**
 * Applies the latest state: starts Faro the first time it is wanted, pauses it when it isn't
 * (sign-out, the demo, every switch off), and starts or pauses Session Replay. Never throws and
 * never blocks the app; an SDK that fails to load leaves telemetry off.
 */
export async function applyTelemetry(
  next: TelemetryState,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  state = next;
  const wanted = wantsTelemetry(next);
  if (!wanted && !running) return;
  running ??= (async () => {
    try {
      const [version, { startFaro }] = await Promise.all([
        loadVersion(fetcher),
        import("./faro"),
      ]);
      return startFaro({ version, state: telemetryState });
    } catch {
      return null;
    }
  })();
  const faro = await running;
  if (!faro || state !== next) return;
  if (wanted) faro.resume();
  else faro.pause();
  await faro.setReplay(wantsReplay(next));
}
