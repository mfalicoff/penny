import { expect, test, type Page } from "@playwright/test";
import { openSettings } from "./shell";

// The redesigned shell in a real browser (MAZ-85): layouts at the breakpoints, no horizontal
// scrolling at 320px, 200% zoom or doubled text, long names, themes, reduced motion and focus.
// /api is mocked; real-stack journeys are MAZ-95/96.

const LONG_EMAIL = "alexandra.konstantinopoulou-montgomery-smythe@an-unusually-long-domain.example.test";

async function mockApi(page: Page, email = "alex@example.test") {
  await page.route("/api/info", (route) => route.fulfill({ json: { name: "penny", version: "2.0.0-e2e" } }));
  await page.route("/api/auth/me", (route) => route.fulfill({ json: { email } }));
  await page.route("/api/ledger", (route) =>
    route.fulfill({ json: { revision: 0, ledger: { version: 4, currency: "CAD", accounts: [], trips: [], categories: [], transactions: [], recurring: [] } } }),
  );
  await page.route("/api/v1/search/transactions", (route) => route.fulfill({ json: { version: 1, items: [], totalCount: 0, nextCursor: null } }));
  // Household screens (MAZ-91) have their own journeys in households.spec.ts; here they find nothing.
  await page.route("/api/households", (route) => route.fulfill({ json: { households: [] } }));
  await page.route("/api/households/**", (route) => route.fulfill({ status: 404, json: { error: "Household not found." } }));
}

const ROUTES: [string, string][] = [
  ["/", "Home"],
  ["/transactions?q=coffee", "Activity"],
  ["/insights", "Insights"],
  ["/households", "Shared"],
  ["/households/h-1", "Household"],
  ["/trips", "Trips"],
  ["/recurring", "Recurring"],
  ["/accounts", "Accounts"],
  ["/categories", "Categories"],
  ["/settings", "Settings"],
  ["/settings/appearance", "Settings"],
  ["/settings/currency", "Settings"],
];

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe("layouts", () => {
  test.skip(({ isMobile }) => isMobile, "sets its own viewports");

  for (const width of [320, 390, 768, 1024, 1100, 1440]) {
    test(`every page fits ${width}px without horizontal scrolling`, async ({ page }) => {
      await mockApi(page, LONG_EMAIL);
      await page.setViewportSize({ width, height: 800 });
      for (const [path, title] of ROUTES) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
        expect(await horizontalOverflow(page), `${path} at ${width}px`).toBeLessThanOrEqual(0);
      }
    });
  }

  test("phones get tabs, tablets an icon rail, desktops the full sidebar", async ({ page }) => {
    await mockApi(page);
    const tabs = page.getByRole("navigation", { name: "Tabs" });
    const activity = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Activity" });

    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/");
    await expect(tabs).toBeVisible();
    await expect(activity).toBeHidden();
    await expect(page.getByRole("button", { name: "Add entry" })).toBeVisible();

    await page.setViewportSize({ width: 900, height: 800 });
    await expect(tabs).toBeHidden();
    await expect(activity).toBeVisible();
    // Rail: the label is visually hidden but still names the link.
    const railWidth = await activity.evaluate((link) => link.getBoundingClientRect().width);
    expect(railWidth).toBeLessThan(60);
    await expect(page.getByRole("searchbox", { name: "Search entries" })).toBeVisible();

    await page.setViewportSize({ width: 1300, height: 800 });
    await expect(page.getByText("Together")).toBeVisible();
    expect(await activity.evaluate((link) => link.getBoundingClientRect().width)).toBeGreaterThan(150);
  });

  test("200% zoom and doubled text keep pages usable without horizontal scrolling", async ({ page }) => {
    await mockApi(page, LONG_EMAIL);
    // A 1280px window at 200% zoom lays out at 640 CSS pixels.
    await page.setViewportSize({ width: 640, height: 450 });
    for (const [path, title] of ROUTES) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      expect(await horizontalOverflow(page), `${path} zoomed`).toBeLessThanOrEqual(0);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    for (const [path] of ROUTES.slice(0, 3)) {
      await page.goto(path);
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      expect(await horizontalOverflow(page), `${path} with large text`).toBeLessThanOrEqual(0);
    }
  });
});

test.describe("appearance", () => {
  test("follows the system, and a pinned theme wins over it", async ({ page }) => {
    await mockApi(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/settings/appearance");
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(await background()).toBe("rgb(0, 0, 0)");

    await page.getByRole("radio", { name: "Light" }).click();
    expect(await background()).toBe("rgb(242, 241, 238)");
    await page.reload();
    await expect(page.getByRole("radio", { name: "Light" })).toBeChecked();
    expect(await background()).toBe("rgb(242, 241, 238)");
  });

  test("reduced transparency makes glass opaque", async ({ page }) => {
    await mockApi(page);
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/");
    const tabbar = page.getByRole("navigation", { name: "Tabs" });
    const filter = () => tabbar.evaluate((element) => getComputedStyle(element).backdropFilter);
    expect(await filter()).toContain("blur");
    await page.evaluate(() => {
      document.documentElement.dataset.transparency = "reduced";
    });
    expect(await filter()).toBe("none");
  });

  test("reduced motion removes transitions", async ({ page }) => {
    await mockApi(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/settings/appearance");
    const duration = await page
      .getByRole("switch", { name: "Reduce transparency" })
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).transitionDuration));
    expect(duration).toBeLessThan(0.001);
  });
});

test.describe("keyboard and history", () => {
  test.skip(({ isMobile }) => isMobile, "keyboard journey");

  test("shortcuts, dialog focus and back/forward work in a real browser", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("searchbox", { name: "Search entries" })).toBeFocused();
    await page.keyboard.type("rent");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL("/transactions?q=rent");

    await page.getByRole("searchbox", { name: "Search transactions" }).blur();
    await page.keyboard.press("g");
    await page.keyboard.press("t");
    await expect(page).toHaveURL("/trips");

    const add = page.getByRole("button", { name: "Add entry" });
    await add.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Add entry" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(add).toBeFocused();

    await page.goBack();
    await expect(page).toHaveURL("/transactions?q=rent");
    await expect(page.getByRole("searchbox", { name: "Search transactions" })).toHaveValue("rent");
    await page.goForward();
    await expect(page.getByRole("heading", { level: 1, name: "Trips" })).toBeVisible();
  });
});

test("the More drawer reaches every page on a phone", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone navigation");
  await mockApi(page);
  await page.goto("/");
  await openSettings(page);
  await expect(page).toHaveURL("/settings");
  await page.getByRole("link", { name: "Currency" }).click();
  await expect(page.getByRole("group", { name: "Ledger currency" })).toBeVisible();
  // On phones each section is its own page with a way back to the list.
  await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeHidden();
  await page.getByRole("link", { name: "All settings" }).click();
  await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test("the demo stays in the tab: no private API calls, and a reload ends it", async ({ page }) => {
  const requests: string[] = [];
  await page.route("/api/info", (route) => route.fulfill({ json: { name: "penny", version: "2.0.0-e2e" } }));
  await page.route("/api/auth/me", (route) => route.fulfill({ status: 401, json: { error: "Please sign in to continue." } }));
  await page.route("/api/auth/oidc", (route) => route.fulfill({ json: { enabled: false } }));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(new URL(request.url()).pathname);
  });

  await page.goto("/transactions");
  await page.getByRole("button", { name: "Explore a demo" }).click();
  await expect(page.getByText("You're exploring a demo")).toBeVisible();
  await expect(page.getByText("Weekly groceries")).toBeVisible();
  const before = requests.length;
  await page.getByRole("searchbox", { name: "Search transactions" }).fill("rent");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Rent", { exact: true })).toBeVisible();
  expect(requests.slice(before)).toEqual([]);
  expect(requests).not.toContain("/api/ledger");
  expect(requests).not.toContain("/api/v1/search/transactions");

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});
