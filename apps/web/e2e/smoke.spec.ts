import type { Page, Request } from "@playwright/test";
import { expect, test } from "./test";
import { openSettings } from "./shell";

/** Collects console errors, page errors and failed requests for the whole test. */
function watchForErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") errors.push(`console.${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => errors.push(`requestfailed: ${request.url()}`));
  return errors;
}

test.beforeEach(async ({ page }) => {
  await page.route("/api/info", (route) => route.fulfill({ json: { name: "penny", version: "2.0.0-e2e" } }));
  await page.route("/api/auth/me", (route) => route.fulfill({ json: { email: "alex@example.test" } }));
  await page.route("/api/ledger", (route) =>
    route.fulfill({ json: { revision: 0, ledger: { version: 4, currency: "CAD", accounts: [], trips: [], categories: [], transactions: [], recurring: [] } } }),
  );
  await page.route("/api/v1/search/transactions", (route) => route.fulfill({ json: { version: 1, items: [], totalCount: 0, nextCursor: null } }));
  // The sidebar lists households and shared trips (MAZ-221); this account has none.
  await page.route("/api/households", (route) => route.fulfill({ json: { households: [] } }));
  // Activity adds your share of shared expenses (MAZ-88).
  await page.route("/api/households/projection**", (route) => route.fulfill({ json: { transactions: [], scheduled: [] } }));
  // Emailed receipts (MAZ-184) are off on this server; the route still answers 200.
  await page.route("/api/receipt-email", (route) => route.fulfill({ json: { enabled: false, domain: null, address: null } }));
  // Settings › Server & sync names the sign-in methods.
  await page.route("/api/auth/oidc", (route) => route.fulfill({ json: { enabled: false } }));
});

test("production build renders Home with the bundled font and no console errors", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Home", exact: true })).toBeVisible();
  await openSettings(page);
  await page.getByRole("link", { name: /^(Server & sync|.+ Sign out to change servers)$/ }).click();
  await expect(page.getByText("Version 2.0.0-e2e · Email sign-in")).toBeVisible();

  const inter = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('16px "Inter"') && [...document.fonts].some((f) => f.family.includes("Inter") && f.status === "loaded");
  });
  expect(inter).toBe(true);

  const license = await page.request.get("/licenses/Inter-OFL.txt");
  expect(license.ok()).toBe(true);
  expect(await license.text()).toContain("SIL OPEN FONT LICENSE");
  expect(errors).toEqual([]);
});

test("deep links load and keyboard navigation reaches every route", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/transactions?q=coffee");
  await expect(page.getByRole("heading", { level: 1, name: "Activity" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search transactions" })).toHaveValue("coffee");

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();

  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { level: 1, name: "Home", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("the layout fits a 320px window without horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/transactions");
  await expect(page.getByRole("heading", { level: 1, name: "Activity" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("Activity downloads the ledger once when it opens, as Home does", async ({ page }) => {
  // Each GET /api/ledger sends every entry: the offline store's sync is the only reader on these
  // pages (Activity's currency comes from that ledger, not from a second Query download).
  for (const path of ["/", "/transactions"]) {
    const reads: string[] = [];
    const count = (request: Request) => {
      if (request.method() === "GET" && new URL(request.url()).pathname === "/api/ledger") reads.push(request.url());
    };
    page.on("request", count);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: path === "/" ? "Home" : "Activity", exact: true })).toBeVisible();
    // Nothing in flight for half a second: a follow-up sync or a late Query read would have started.
    await page.waitForLoadState("networkidle");
    page.off("request", count);
    expect(reads, path).toHaveLength(1);
  }
});

test("an unavailable server is reported without breaking the page", async ({ page }) => {
  await page.route("/api/info", (route) => route.fulfill({ status: 503, json: { error: "Service unavailable." } }));
  await page.goto("/");
  await expect(page.getByText("Can't reach your Penny server")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Home", exact: true })).toBeVisible();
});
