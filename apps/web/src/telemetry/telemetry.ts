import { z } from "zod";

/**
 * Opt-in browser telemetry (MAZ-129). Off unless the server that serves the app sets a
 * collector: the web container's PENNY_WEB_TELEMETRY_URL (or the NixOS module's
 * `webTelemetryUrl`) is published as `/telemetry.json`. Nothing about the collector is compiled
 * into the bundle, and the Faro SDK is downloaded only when it is on.
 */
export const telemetryConfigSchema = z.object({
  // Empty when the server has telemetry off. Grafana Cloud's Faro collector, or your own Alloy
  // (browsers refuse an http collector from an https page).
  collectorUrl: z.union([z.literal(""), z.url({ protocol: /^https?$/ })]).catch(""),
});

export type TelemetryConfig = z.infer<typeof telemetryConfigSchema>;

/** Reads the server's telemetry settings; any failure means telemetry stays off. */
export async function loadTelemetryConfig(fetcher: typeof fetch = fetch): Promise<TelemetryConfig> {
  try {
    const response = await fetcher("/telemetry.json", { cache: "no-store", credentials: "omit" });
    if (!response.ok) return { collectorUrl: "" };
    return telemetryConfigSchema.parse(await response.json());
  } catch {
    return { collectorUrl: "" };
  }
}

async function loadVersion(fetcher: typeof fetch): Promise<string> {
  try {
    const response = await fetcher("/version.json", { cache: "no-store", credentials: "omit" });
    if (!response.ok) return "unknown";
    const { version } = z.object({ version: z.string().min(1).max(100) }).parse(await response.json());
    return version;
  } catch {
    return "unknown";
  }
}

/** Starts telemetry when the server turned it on. Never throws and never blocks the app. */
export async function startTelemetry(fetcher: typeof fetch = fetch): Promise<boolean> {
  const { collectorUrl } = await loadTelemetryConfig(fetcher);
  if (!collectorUrl) return false;
  try {
    const [version, { startFaro }] = await Promise.all([loadVersion(fetcher), import("./faro")]);
    startFaro({ collectorUrl, version });
    return true;
  } catch {
    return false;
  }
}
