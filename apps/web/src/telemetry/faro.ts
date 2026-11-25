// Loaded only once telemetry is wanted (./telemetry.ts), so the SDK costs nothing otherwise.
import { FetchTransport, getWebInstrumentations, initializeFaro, InternalLoggerLevel, TransportItemType, type TransportItem } from "@grafana/faro-web-sdk";
import { TracingInstrumentation } from "@grafana/faro-web-tracing";
import type { ReplayInstrumentation } from "@grafana/faro-instrumentation-replay";
import { isDemo } from "../demo/demo";
import { maskReplayEvent, scrubItem, scrubUrl } from "./scrub";
import type { TelemetryState } from "./telemetry";

/** The API endpoint every report goes to; it forwards to the operator's collector. */
export const TELEMETRY_PATH = "/api/telemetry/faro";
const REPLAY_EVENT = "faro.session_recording.";

/** Which choice an item needs: errors, performance or replay; session bookkeeping needs any. */
export function allowed(item: TransportItem, state: TelemetryState): boolean {
  const { errors, performance, replay } = state.choices;
  switch (item.type) {
    case TransportItemType.EXCEPTION:
    case TransportItemType.LOG:
      return errors;
    case TransportItemType.MEASUREMENT:
    case TransportItemType.TRACE:
      return performance;
    case TransportItemType.EVENT: {
      const name = (item.payload as { name?: unknown }).name;
      if (typeof name === "string" && name.startsWith(REPLAY_EVENT))
        return replay && state.serverReplay;
      if (typeof name === "string" && name.startsWith("faro.performance"))
        return performance;
      return errors || performance || replay;
    }
    default:
      return false;
  }
}

export function startFaro({
  version,
  state,
}: {
  version: string;
  state: () => TelemetryState;
}) {
  const faro = initializeFaro({
    // service.name in Grafana; the API accepts only this app name on this endpoint.
    app: { name: "penny-web", version, environment: "production" },
    transports: [
      // Same origin with the session cookie: the API authenticates, scrubs and forwards.
      new FetchTransport({
        url: TELEMETRY_PATH,
        requestOptions: { credentials: "same-origin" },
      }),
    ],
    // Fewer, larger requests: the API allows each session a few per second at most.
    batching: { enabled: true, sendTimeout: 1000, itemLimit: 100 },
    instrumentations: [
      // Errors, web vitals, page loads, navigation and request timings. No console capture:
      // console output can contain anything.
      ...getWebInstrumentations({ captureConsole: false }),
      // Same-origin /api/ calls carry `traceparent`, so a browser trace continues into the API.
      // The API never lets it decide sampling.
      new TracingInstrumentation(),
    ],
    // Never a user: no id, email or name is attached. The session id is random per tab.
    sessionTracking: { enabled: true, persistent: false },
    pageTracking: { generatePageId: (location) => scrubUrl(location.href) },
    trackGeolocation: false,
    // Faro's own problems (an unreachable API) must never reach the console.
    internalLoggerLevel: InternalLoggerLevel.OFF,
    // Only what the person agreed to, never in the demo, and always scrubbed.
    beforeSend: (item) => {
      const current = state();
      if (!current.active || isDemo() || !allowed(item, current)) return null;
      return scrubItem(item);
    },
  });

  let replay: Promise<ReplayInstrumentation> | null = null;
  return {
    pause: () => {
      faro.pause();
    },
    resume: () => {
      faro.unpause();
    },
    // The recorder is its own download, fetched the first time someone turns replay on.
    setReplay: async (on: boolean) => {
      if (on && !replay) {
        replay = import("@grafana/faro-instrumentation-replay").then(
          ({ ReplayInstrumentation }) => {
            const instrumentation = new ReplayInstrumentation({
              // Every text and field is masked, and images, video and canvases are blocked, so no
              // entry, amount, title, note, name, email or search can appear in a recording.
              maskAllInputs: true,
              maskTextSelector: "*",
              blockSelector: "img, picture, video, canvas, iframe",
              inlineImages: false,
              collectFonts: false,
              inlineStylesheet: false,
              recordCrossOriginIframes: false,
              sanitizeMetaHref: true,
              // rrweb leaves attributes alone; labels, titles and ids can carry the same text.
              beforeSend: maskReplayEvent,
            });
            faro.instrumentations.add(instrumentation);
            return instrumentation;
          },
        );
        await replay;
      } else if (replay) {
        const recorder = await replay;
        if (on) recorder.resumeRecording();
        else recorder.pauseRecording();
      }
    },
  };
}
