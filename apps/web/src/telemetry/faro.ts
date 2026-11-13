// Loaded only when the server turns telemetry on (./telemetry.ts), so the SDK costs nothing
// otherwise.
import { getWebInstrumentations, initializeFaro, InternalLoggerLevel } from "@grafana/faro-web-sdk";
import { TracingInstrumentation } from "@grafana/faro-web-tracing";
import { isDemo } from "../demo/demo";
import { scrubItem, scrubUrl } from "./scrub";

export function startFaro({ collectorUrl, version }: { collectorUrl: string; version: string }) {
  initializeFaro({
    url: collectorUrl,
    // service.name in Grafana; matches the self-hosted stack's client dashboard and alerts.
    app: { name: "penny-web", version, environment: "production" },
    instrumentations: [
      // Errors, web vitals, page loads, navigation and request timings. No console capture:
      // console output can contain anything.
      ...getWebInstrumentations({ captureConsole: false }),
      // Same-origin /api/ calls carry `traceparent`, so a browser trace continues into the API.
      new TracingInstrumentation(),
    ],
    // Never a user: no id, email or name is attached. The session id is random per tab.
    sessionTracking: { enabled: true, persistent: false },
    pageTracking: { generatePageId: (location) => scrubUrl(location.href) },
    trackGeolocation: false,
    // Faro's own problems (an unreachable collector) must never reach the console.
    internalLoggerLevel: InternalLoggerLevel.OFF,
    // The demo runs on sample data in memory and sends nothing; everything else is scrubbed.
    beforeSend: (item) => (isDemo() ? null : scrubItem(item)),
  });
}
