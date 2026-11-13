import { describe, expect, it, vi } from "vitest";
import { startDemo, stopDemo } from "../demo/demo";
import { createQueryClient } from "../app/queryClient";
import { loadTelemetryConfig, startTelemetry } from "./telemetry";

const initializeFaro = vi.hoisted(() => vi.fn());
vi.mock("@grafana/faro-web-sdk", () => ({
  initializeFaro,
  getWebInstrumentations: () => [],
  InternalLoggerLevel: { OFF: 0 },
}));
vi.mock("@grafana/faro-web-tracing", () => ({ TracingInstrumentation: vi.fn() }));

const collector = "https://faro-collector-prod-us-east-0.grafana.net/collect/0123456789abcdef";

// The app only fetches root-relative paths as strings.
function serving(files: Record<string, unknown>): typeof fetch {
  return vi.fn((input: string) => {
    const body = files[input];
    return Promise.resolve(body === undefined ? new Response("not found", { status: 404 }) : Response.json(body));
  }) as unknown as typeof fetch;
}

describe("telemetry configuration", () => {
  it("is off when the server names no collector, or sends anything unexpected", async () => {
    for (const files of [{}, { "/telemetry.json": { collectorUrl: "" } }, { "/telemetry.json": { collectorUrl: "javascript:alert(1)" } }, { "/telemetry.json": "nonsense" }]) {
      expect(await loadTelemetryConfig(serving(files))).toEqual({ collectorUrl: "" });
    }
    const failing = vi.fn(() => Promise.reject(new TypeError("offline"))) as typeof fetch;
    expect(await loadTelemetryConfig(failing)).toEqual({ collectorUrl: "" });
  });

  it("does not load the SDK when telemetry is off", async () => {
    initializeFaro.mockClear();
    expect(await startTelemetry(serving({ "/telemetry.json": { collectorUrl: "" } }))).toBe(false);
    expect(initializeFaro).not.toHaveBeenCalled();
  });

  it("starts Faro with the server's collector and the build version, as penny-web", async () => {
    initializeFaro.mockClear();
    expect(await startTelemetry(serving({ "/telemetry.json": { collectorUrl: collector }, "/version.json": { version: "2.1.0", revision: "abc" } }))).toBe(true);
    expect(initializeFaro).toHaveBeenCalledOnce();
    const config = initializeFaro.mock.calls[0]?.[0] as { url: string; app: unknown; trackGeolocation: boolean };
    expect(config.url).toBe(collector);
    expect(config.app).toEqual({ name: "penny-web", version: "2.1.0", environment: "production" });
    expect(config.trackGeolocation).toBe(false);
  });

  it("scrubs every item and sends nothing during the demo", async () => {
    initializeFaro.mockClear();
    await startTelemetry(serving({ "/telemetry.json": { collectorUrl: collector } }));
    const { beforeSend, app } = initializeFaro.mock.calls[0]?.[0] as { beforeSend: (item: unknown) => unknown; app: { version: string } };
    expect(app.version).toBe("unknown");

    const item = { type: "log", payload: { message: "Saved 3 entries for ana@example.com" }, meta: { page: { url: "https://penny.example.com/trips/9f2c?from=home" } } };
    expect(beforeSend(item)).toEqual({ type: "log", payload: { message: "Saved <n> entries for <email>" }, meta: { page: { url: "https://penny.example.com/trips/:id" } } });

    await startDemo(createQueryClient());
    expect(beforeSend(item)).toBeNull();
    stopDemo();
    expect(beforeSend(item)).not.toBeNull();
  });
});
