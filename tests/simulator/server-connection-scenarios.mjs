import assert from "node:assert/strict";
import { resolve } from "node:path";

/** The same UI journey runs against the native app on both mobile platforms. */
export async function runServerConnectionScenarios(t, {
  device, open, requests, originalUrl, selectedUrl, impostorUrl, version, artifacts, settingsNeedsScroll = true,
}) {
  const button = (label) => `role="button" label=${JSON.stringify(label)}`;
  const press = (label) => device("press", button(label), "--settle");
  const waitText = (text) => device("wait", "text", text);
  const fillUrl = async (value) => {
    await device("fill", 'id="penny-server-url"', value, "--settle");
    const actual = await device("get", "text", 'id="penny-server-url"');
    assert.ok(actual.includes(value), `The native URL field did not retain the entered value: ${actual}`);
  };
  // Later steps depend on earlier state; do not cascade UI actions after failure.
  async function scenario(name, run) {
    let failure;
    await t.test(name, async () => {
      try { await run(); } catch (error) { failure = error; throw error; }
    });
    if (failure) throw failure;
  }
  const screenshot = (name) => device("screenshot", resolve(artifacts, name));
  await open();
  await waitText("Penny server");

  await scenario("first launch retains the build's existing URL without an identity probe", async () => {
    await waitText(originalUrl);
    assert.equal(requests.some((request) => request.path === "/api/info"), false);
    await screenshot("01-original-server.png");
  });

  await scenario("invalid and non-Penny URLs cannot be saved", async () => {
    await press("Change server");
    await fillUrl("not-a-url");
    await press("Check server");
    await waitText("Enter a full server URL");
    assert.doesNotMatch(await device("snapshot", "-i"), /\[button\] "Use this server"/);
    await fillUrl(impostorUrl);
    await press("Check server");
    await waitText("This address did not identify itself as a Penny server");
    assert.doesNotMatch(await device("snapshot", "-i"), /\[button\] "Use this server"/);
    const request = requests.find((request) => request.server === "impostor");
    assert.equal(request?.path, "/api/info");
    assert.equal(request.authorization, undefined);
    assert.equal(request.cookie, undefined);
    await screenshot("02-non-penny-rejected.png");
  });

  await scenario("Penny's version is displayed and editing invalidates verification", async () => {
    await fillUrl(`${selectedUrl}/`);
    await press("Check server");
    await waitText(`Penny ${version} · Server verified`);
    await screenshot("03-version-verified.png");
    await fillUrl(impostorUrl);
    assert.doesNotMatch(await device("snapshot", "-i"), /\[button\] "Use this server"/);
    await fillUrl(`${selectedUrl}/`);
    await press("Check server");
    await waitText(`Penny ${version} · Server verified`);
    await press("Use this server");
    await waitText(selectedUrl);
    await waitText(`Penny ${version}`);
  });

  await scenario("the selected server survives native process termination and relaunch", async () => {
    const previousRequests = requests.length;
    await device("close");
    await open();
    await waitText("Penny server");
    await waitText(selectedUrl);
    await waitText(`Penny ${version}`);
    assert.ok(requests.slice(previousRequests).some((request) => request.server === "selected" && request.path === "/api/auth/me"), "Relaunch must reach the selected backend");
    await screenshot("04-persisted-after-relaunch.png");
  });

  await scenario("Settings displays the device's selected server without allowing an active-workspace switch", async () => {
    await device("scroll", "bottom", "--settle");
    await press("Take a look around with sample data");
    await device("wait", button("Account settings"));
    await press("Account settings");
    await waitText("Your personal space");
    if (settingsNeedsScroll) await device("scroll", "down", "--settle");
    await waitText(selectedUrl);
    await waitText("To change servers, sync your entries and sign out first");
    assert.doesNotMatch(await device("snapshot", "-i"), /\[button\] "Change server"/);
    await screenshot("05-settings-server.png");
    if (settingsNeedsScroll) await device("scroll", "bottom", "--settle");
    await press("Leave demo");
    await waitText("Penny server");
    await waitText(selectedUrl);
  });
}
