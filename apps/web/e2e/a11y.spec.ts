import { appendFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { enterDemo, navigate, startDemo } from "./demo";
import known from "./a11y-known.json" with { type: "json" };

// MAZ-96 automated accessibility scans: axe-core (WCAG 2.0/2.1/2.2 A and AA rules) over every
// top-level page of the demo, the sign-in screen and the Add entry dialog, in light and dark, and
// under forced colors, on each project's layout (desktop, phone). No request reaches the API.
//
// Violations the scans found when this suite was added are listed, with their reason, in
// e2e/a11y-known.json (docs/acceptance.md, accessibility results). They are tracked gaps, not
// accepted behavior: a violation that isn't listed fails the test, and a listed one that no longer
// occurs fails it too, so the list only shrinks. PENNY_A11Y_REPORT=<file> appends every violation
// found as JSON lines, for triage.

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const PAGES = ["Home", "Activity", "Insights", "Trips", "Recurring", "Accounts", "Categories", "Settings"] as const;
// Firefox runs axe several times slower; nine scans need more than the default 30 s.
test.describe.configure({ timeout: 120_000 });

const allowed = known.violations as { scan: string; rule: string; projects: string[]; except?: string[]; reason: string }[];

async function scan(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const found = result.violations.map((violation) => violation.id).sort();
  const report = process.env.PENNY_A11Y_REPORT;
  if (report) {
    for (const violation of result.violations) {
      appendFileSync(
        report,
        `${JSON.stringify({ project: test.info().project.name, scan: label, rule: violation.id, impact: violation.impact, nodes: violation.nodes.map((node) => ({ target: node.target.join(" "), summary: node.failureSummary })) })}\n`,
      );
    }
  }
  // The baseline was recorded on Chromium; other engines are held to the same layout's entries.
  const layout = `chromium-${test.info().project.name.split("-").pop() ?? "desktop"}`;
  const expected = allowed
    .filter((item) => item.scan === label && item.projects.includes(layout) && !item.except?.includes(test.info().project.name))
    .map((item) => item.rule)
    .sort();
  // Soft, so one scan reports every page.
  expect.soft(found, `${label}: axe violations (known: ${expected.join(", ") || "none"})`).toEqual(expected);
  expect(result.passes.length, `${label}: axe ran its checks`).toBeGreaterThan(10);
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`every page passes axe in ${colorScheme}`, async ({ page }) => {
    await startDemo(page, { colorScheme });
    await scan(page, `sign-in ${colorScheme}`);
    await enterDemo(page);
    for (const name of PAGES) {
      await navigate(page, name);
      await scan(page, `${name} ${colorScheme}`);
    }
  });
}

test("the Add entry dialog passes axe, and Escape returns focus to its opener", async ({ page }) => {
  await startDemo(page);
  await enterDemo(page);
  await navigate(page, "Activity");
  // Opened from the keyboard: WebKit does not focus a button on click, so focus return is only defined this way.
  const opener = page.getByRole("button", { name: "Add entry" }).first();
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Add entry" });
  await expect(dialog).toBeVisible();
  await scan(page, "Add entry");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("forced colors and reduced motion keep Home and Activity scannable", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await startDemo(page);
  await enterDemo(page);
  await scan(page, "Home forced-colors");
  await navigate(page, "Activity");
  await scan(page, "Activity forced-colors");
});
