import { test } from "node:test";
import * as android from "./support/android.mjs";
import { runServerConnectionTest } from "./support/server-connection-harness.mjs";

// Only source AVD configuration is reused, never app data or snapshots.
test("Android Emulator: server validation, selection and persistence", { timeout: 600000 }, async (t) => {
  await runServerConnectionTest(t, "android", android);
});
