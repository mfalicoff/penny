import { test } from "node:test";
import * as ios from "./support/ios.mjs";
import { runServerConnectionTest } from "./support/server-connection-harness.mjs";

// UI actions go through agent-device against an isolated native simulator.
test("iOS Simulator: server validation, selection and persistence", { timeout: 600000 }, async (t) => {
  await runServerConnectionTest(t, "ios", ios);
});
