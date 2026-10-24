import { runServerConnectionScenarios } from "../server-connection-scenarios.mjs";
import { commonPreflight, createNativeHarness } from "./lifecycle.mjs";
import { createServerConnectionFixture } from "./server-connection-fixture.mjs";

export async function runServerConnectionTest(t, platform, adapter) {
  await commonPreflight();
  const source = await adapter.preflight();
  const harness = await createNativeHarness(t, platform, "server-connection", adapter[`${platform}Env`]);
  const fixture = await createServerConnectionFixture(harness);
  const native = await adapter.start(harness, source);
  const port = await harness.startMetro(fixture.originalUrl);
  await native.connect?.(port, [fixture.originalUrl, fixture.selectedUrl, fixture.impostorUrl]);
  await runServerConnectionScenarios(t, {
    ...fixture,
    device: harness.device,
    artifacts: harness.artifacts,
    open: () => native.open(port),
    settingsNeedsScroll: native.settingsNeedsScroll ?? true,
  });
}
