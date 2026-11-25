import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../app/queryClient";
import type { TelemetryState } from "./telemetry";

const faro = vi.hoisted(() => ({
  pause: vi.fn(),
  unpause: vi.fn(),
  instrumentations: { add: vi.fn() },
}));
const initializeFaro = vi.hoisted(() => vi.fn<(config: unknown) => typeof faro>(() => faro));
const transports = vi.hoisted(() => [] as unknown[]);
const replays = vi.hoisted(
  () =>
    [] as {
      options: unknown;
      pauseRecording: ReturnType<typeof vi.fn>;
      resumeRecording: ReturnType<typeof vi.fn>;
    }[],
);
vi.mock("@grafana/faro-web-sdk", () => ({
  initializeFaro,
  getWebInstrumentations: () => [],
  InternalLoggerLevel: { OFF: 0 },
  TransportItemType: { EXCEPTION: "exception", LOG: "log", MEASUREMENT: "measurement", TRACE: "trace", EVENT: "event" },
  FetchTransport: class {
    constructor(readonly options: unknown) {
      transports.push(options);
    }
  },
}));
vi.mock("@grafana/faro-web-tracing", () => ({
  TracingInstrumentation: vi.fn(),
}));
vi.mock("@grafana/faro-instrumentation-replay", () => ({
  ReplayInstrumentation: class {
    pauseRecording = vi.fn();
    resumeRecording = vi.fn();
    constructor(readonly options: unknown) {
      replays.push(this);
    }
  },
}));

const versionOnly = vi.fn(() =>
  Promise.resolve(Response.json({ version: "3.0.0", revision: "abc" })),
) as unknown as typeof fetch;

const on: TelemetryState = {
  active: true,
  serverWeb: true,
  serverReplay: true,
  choices: { errors: true, performance: true, replay: false, decided: true },
};

// The SDK starts once per page, so each test gets a fresh module.
async function load() {
  vi.resetModules();
  return import("./telemetry");
}

type Config = {
  beforeSend: (item: unknown) => unknown;
  app: unknown;
  trackGeolocation: boolean;
  url?: string;
};
const config = () => initializeFaro.mock.calls.at(-1)?.[0] as Config;

beforeEach(() => {
  initializeFaro.mockClear();
  faro.pause.mockClear();
  faro.unpause.mockClear();
  faro.instrumentations.add.mockClear();
  transports.length = 0;
  replays.length = 0;
});

describe("telemetry", () => {
  it("never loads the SDK until the server offers it, the person is signed in and chose to share", async () => {
    const { applyTelemetry, OFF } = await load();
    for (const state of [
      OFF,
      { ...on, serverWeb: false },
      { ...on, active: false },
      {
        ...on,
        choices: {
          errors: false,
          performance: false,
          replay: false,
          decided: true,
        },
      },
      // Replay alone needs the server to offer replay.
      {
        ...on,
        serverReplay: false,
        choices: {
          errors: false,
          performance: false,
          replay: true,
          decided: true,
        },
      },
    ]) {
      await applyTelemetry(state, versionOnly);
    }
    expect(initializeFaro).not.toHaveBeenCalled();
  });

  it("sends to the API with the session cookie as penny-web, never to a collector", async () => {
    const { applyTelemetry } = await load();
    await applyTelemetry(on, versionOnly);
    expect(initializeFaro).toHaveBeenCalledOnce();
    expect(config().url).toBeUndefined();
    expect(transports).toEqual([
      {
        url: "/api/telemetry/faro",
        requestOptions: { credentials: "same-origin" },
      },
    ]);
    expect(config().app).toEqual({
      name: "penny-web",
      version: "3.0.0",
      environment: "production",
    });
    expect(config().trackGeolocation).toBe(false);
    expect(faro.unpause).toHaveBeenCalled();
  });

  it("sends only what the person chose, scrubbed, and nothing during the demo or after sign-out", async () => {
    const { applyTelemetry } = await load();
    // The fresh module graph's demo, the one Faro's beforeSend reads.
    const { startDemo, stopDemo } = await import("../demo/demo");
    await applyTelemetry(
      {
        ...on,
        choices: {
          errors: true,
          performance: false,
          replay: false,
          decided: true,
        },
      },
      versionOnly,
    );
    const { beforeSend } = config();
    const error = {
      type: "exception",
      payload: { type: "Error", value: "Saved 3 entries for ana@example.com" },
      meta: { page: { url: "https://penny.example.com/trips/9f2c?from=home" } },
    };
    const timing = {
      type: "measurement",
      payload: { type: "web-vitals", values: { lcp: 1200 } },
      meta: {},
    };
    const replay = {
      type: "event",
      payload: { name: "faro.session_recording.event", attributes: {} },
      meta: {},
    };
    expect(beforeSend(error)).toEqual({
      ...error,
      payload: { type: "Error", value: "Saved <n> entries for <email>" },
      meta: { page: { url: "https://penny.example.com/trips/:id" } },
    });
    expect(beforeSend(timing)).toBeNull();
    expect(beforeSend(replay)).toBeNull();

    await startDemo(createQueryClient());
    expect(beforeSend(error)).toBeNull();
    stopDemo();
    expect(beforeSend(error)).not.toBeNull();

    await applyTelemetry({ ...on, active: false }, versionOnly);
    expect(beforeSend(error)).toBeNull();
    expect(faro.pause).toHaveBeenCalled();
  });

  it("pauses when every switch is turned off and resumes when one is turned on", async () => {
    const { applyTelemetry } = await load();
    await applyTelemetry(on, versionOnly);
    await applyTelemetry(
      {
        ...on,
        choices: {
          errors: false,
          performance: false,
          replay: false,
          decided: true,
        },
      },
      versionOnly,
    );
    expect(faro.pause).toHaveBeenCalledOnce();
    await applyTelemetry(on, versionOnly);
    expect(faro.unpause).toHaveBeenCalledTimes(2);
    expect(initializeFaro).toHaveBeenCalledOnce();
  });

  it("records Session Replay masked, only when chosen and offered, and stops when turned off", async () => {
    const { applyTelemetry } = await load();
    await applyTelemetry(on, versionOnly);
    expect(replays).toHaveLength(0);
    const withReplay = { ...on, choices: { ...on.choices, replay: true } };
    await applyTelemetry(withReplay, versionOnly);
    expect(replays).toHaveLength(1);
    expect(faro.instrumentations.add).toHaveBeenCalledWith(replays[0]);
    expect(replays[0]?.options).toMatchObject({
      maskAllInputs: true,
      maskTextSelector: "*",
      inlineImages: false,
      sanitizeMetaHref: true,
    });
    expect(
      config().beforeSend({
        type: "event",
        payload: { name: "faro.session_recording.event", attributes: {} },
        meta: {},
      }),
    ).not.toBeNull();

    await applyTelemetry(on, versionOnly);
    expect(replays[0]?.pauseRecording).toHaveBeenCalledOnce();
    expect(
      config().beforeSend({
        type: "event",
        payload: { name: "faro.session_recording.event", attributes: {} },
        meta: {},
      }),
    ).toBeNull();
    await applyTelemetry(withReplay, versionOnly);
    expect(replays[0]?.resumeRecording).toHaveBeenCalledOnce();
    expect(replays).toHaveLength(1);
  });
});
