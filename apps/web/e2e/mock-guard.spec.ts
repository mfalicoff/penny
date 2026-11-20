import { expect, test, UNMOCKED_STATUS } from "./test";

// The mocked specs' guard (MAZ-211, e2e/test.ts): an /api request no mock answers never reaches
// vite preview's proxy, and it is recorded so the test fails.

test.describe("the unmocked /api guard", () => {
  test.skip(({ isMobile }) => isMobile, "the guard doesn't depend on the form factor");

  test("answers an unmocked request itself and records it", async ({ page, mockedApi }) => {
    // A static file: the app doesn't start, so it sends no /api requests of its own.
    await page.goto("/favicon.svg");
    const status = await page.evaluate(async () => (await fetch("/api/not-mocked", { method: "POST" })).status);
    expect(status).toBe(UNMOCKED_STATUS);
    expect(mockedApi.unmocked).toEqual(["POST /api/not-mocked"]);
    // Sent on purpose: empty the list so this test passes.
    mockedApi.unmocked.length = 0;
  });

  test("leaves requests to the spec's page and context mocks", async ({ page, mockedApi }) => {
    await page.route("/api/info", (route) => route.fulfill({ json: { name: "penny", version: "2.0.0-e2e" } }));
    await page.context().route("**/api/auth/me", (route) => route.fulfill({ status: 401, json: { error: "Please sign in to continue." } }));
    await page.goto("/favicon.svg");
    const statuses = await page.evaluate(async () => [(await fetch("/api/info")).status, (await fetch("/api/auth/me")).status]);
    expect(statuses).toEqual([200, 401]);
    expect(mockedApi.unmocked).toEqual([]);
  });
});
