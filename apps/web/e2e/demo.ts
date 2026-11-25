import { expect, type Page } from "@playwright/test";

// The temporary demo (src/demo) as a deterministic fixture for the MAZ-96 accessibility, visual
// and responsive checks: sample data in memory, no request reaches the API, and a fixed clock
// keeps the month, totals and schedules stable. A reload ends the demo, so pages are reached the
// way a person would, through the sidebar, the tab bar or More.

export const DEMO_DAY = new Date("2026-11-10T15:00:00");

export async function startDemo(page: Page, options: { colorScheme?: "light" | "dark" } = {}) {
  await page.clock.setFixedTime(DEMO_DAY);
  if (options.colorScheme) await page.emulateMedia({ colorScheme: options.colorScheme });
  await page.route("/api/info", (route) => route.fulfill({ json: { name: "penny", version: "2.0.0-e2e" } }));
  await page.route("/api/auth/me", (route) => route.fulfill({ status: 401, json: { error: "Please sign in to continue." } }));
  await page.route("/api/auth/oidc", (route) => route.fulfill({ json: { enabled: false, providers: [] } }));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();
}

export async function enterDemo(page: Page) {
  await page.getByRole("button", { name: "Take a look around with sample data" }).click();
  await expect(page.getByText("You're exploring a demo")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Home", exact: true })).toBeVisible();
}

/** Opens a top-level page by its navigation label (Home, Activity, Insights, Trips, Recurring, Accounts, Categories, Settings). */
export async function navigate(page: Page, label: string, heading = label) {
  const tabs = page.getByRole("navigation", { name: "Tabs" });
  if (await tabs.isVisible()) {
    const tab = tabs.getByRole("link", { name: label, exact: true });
    if (await tab.count()) await tab.click();
    else {
      // Phones reach Insights from Home's flow card, and the rest from Home's settings button.
      await tabs.getByRole("link", { name: "Home", exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Home", exact: true })).toBeVisible();
      if (label === "Insights") await page.getByRole("main").getByRole("link", { name: "Insights", exact: true }).click();
      else {
        await page.getByRole("link", { name: "Settings", exact: true }).click();
        if (label !== "Settings") await page.getByRole("navigation", { name: "Manage" }).getByRole("link", { name: new RegExp(`^${label}\\b`) }).click();
      }
    }
  } else {
    // Together's links read All households and All trips once there are households or trips, and
    // Recurring adds its count (MAZ-221).
    const all = label === "Trips" ? "All trips" : label === "Shared" ? "All households" : label;
    await page.getByRole("complementary", { name: "Penny" }).getByRole("link", { name: new RegExp(`^(${label}|${all})(\\s|$)`) }).click();
  }
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
}

export const horizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
