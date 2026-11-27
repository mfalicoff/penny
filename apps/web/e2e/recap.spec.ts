import type { Page } from "@playwright/test";
import { enterDemo, horizontalOverflow, navigate } from "./demo";
import { expect, test } from "./test";

// The monthly recap (MAZ-292; cards web-recap, web-recap-empty, web-home-recap, web-insights-recap)
// on the temporary demo (src/demo): its sample data has the two months before this one, so on
// November 3 the banner offers October's recap, compared with September. The clock is fixed so
// the sample dates and totals are stable. Desktop and phone.

const NOV_3 = new Date("2026-11-03T15:00:00");

function watchForErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") errors.push(`console.${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

async function startDemo(page: Page, day = NOV_3) {
  await page.clock.setFixedTime(day);
  await page.route("/api/info", (route) => route.fulfill({ json: { name: "penny", version: "2.0.0-e2e" } }));
  await page.route("/api/auth/me", (route) => route.fulfill({ status: 401, json: { error: "Please sign in to continue." } }));
  await page.route("/api/auth/oidc", (route) => route.fulfill({ json: { enabled: false, providers: [] } }));
  await page.goto("/");
  await enterDemo(page);
}

const banner = (page: Page) => page.getByRole("region", { name: "Your October recap is ready" });

/** Picks a month in the recap's month control: the month list on phones, Previous month on desktop. */
async function previousMonth(page: Page, isMobile: boolean, month: string) {
  if (isMobile) await page.getByLabel("Month", { exact: true }).selectOption(month);
  else await page.getByRole("button", { name: "Previous month" }).click();
}

test("the banner opens October's recap: spent with the months it's compared with, money in and out, changes, shared and highlights", async ({ page, isMobile }) => {
  await startDemo(page);
  const errors = watchForErrors(page);
  await expect(banner(page)).toContainText("Where your money went last month, and what changed.");
  await banner(page).getByRole("link", { name: "See recap" }).click();
  await expect(page).toHaveURL(/\/insights\/recap\?month=2026-10$/);
  await expect(page.getByRole("heading", { level: 1, name: "October recap" })).toBeVisible();

  const spent = page.getByRole("region", { name: /^Spent( · your share)?$/ });
  // Assistive technology hears the final value only, even while it counts.
  await expect(spent).toContainText("$1,963.09");
  await expect(spent).toContainText("6% more than September.");
  await expect(spent.getByRole("definition")).toHaveText(["$1,963", "$1,846", "No Oct 2025 to compare with"]);

  const flow = page.getByRole("region", { name: "Money in and out" });
  await expect(flow).toContainText("Came in $4,800.00");
  // Phones show the totals as a legend in whole units (iphone-recap), from 768px as tiles (web-recap).
  await expect(flow).toContainText(isMobile ? "Invested$200" : "Invested$200.00");
  await expect(flow).toContainText(isMobile ? "Left over$2,637" : "Left over$2,636.91");

  const changes = page.getByRole("region", { name: "Biggest changes" });
  await expect(changes).toContainText("Compared with September");
  if (isMobile) {
    await expect(changes.getByRole("listitem").first()).toContainText("ShoppingNothing in September$74.00New");
  } else {
    const rows = changes.getByRole("row");
    await expect(rows.nth(1)).toContainText("Shopping$74.00—NothingNew");
    await expect(rows.nth(2)).toContainText("Up 343%");
    await expect(rows.nth(3)).toContainText("Down 10%");
  }
  await expect(changes).not.toContainText("∞");

  await expect(page.getByRole("region", { name: "Shared" })).toContainText("Others paid $110.50of your $221.00 in split expenses");
  await expect(page.getByRole("region", { name: "Highlights" })).toContainText("23 days without spendingThe longest run was Oct 10–17");
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("a month with nothing recorded says so, with Add an entry and Choose another month", async ({ page, isMobile }) => {
  await startDemo(page);
  const errors = watchForErrors(page);
  await banner(page).getByRole("link", { name: "See recap" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "October recap" })).toBeVisible();
  // Past months only: October is the latest.
  if (!isMobile) await expect(page.getByRole("button", { name: "Next month" })).toBeDisabled();
  else await expect(page.getByLabel("Month", { exact: true }).locator("option", { hasText: "November 2026" })).toHaveCount(0);

  await previousMonth(page, isMobile, "2026-09");
  await expect(page.getByRole("heading", { level: 1, name: "September recap" })).toBeVisible();
  // September is the demo's first month: nothing before it to compare with.
  await expect(page.getByRole("region", { name: /^Spent( · your share)?$/ })).toContainText("No August to compare with");
  await expect(page.getByRole("region", { name: "Biggest changes" })).toContainText("No August to compare with.");

  await previousMonth(page, isMobile, "2026-08");
  await expect(page.getByRole("heading", { level: 1, name: "August recap" })).toBeVisible();
  const empty = page.getByRole("region", { name: "Nothing to recap yet" });
  await expect(empty).toContainText("A recap needs at least one recorded entry, and August has none. Scheduled entries count once they're recorded.");
  await empty.getByRole("button", { name: "Choose another month" }).click();
  if (isMobile) await expect(page.getByLabel("Month", { exact: true })).toBeFocused();
  else await expect(page.getByRole("button", { name: "Previous month" })).toBeFocused();
  await page.keyboard.press("Escape");
  await empty.getByRole("button", { name: "Add an entry" }).click();
  await expect(page.getByRole("dialog", { name: "New entry" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Insights has the banner and a Recap button; a dismissed banner stays away for that month", async ({ page }) => {
  await startDemo(page);
  const errors = watchForErrors(page);
  await navigate(page, "Insights");
  await expect(banner(page)).toBeVisible();
  await page.getByRole("link", { name: "Recap", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "October recap" })).toBeVisible();
  await page.getByRole("link", { name: "Back to Insights" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Insights" })).toBeVisible();

  await banner(page).getByRole("button", { name: "Dismiss the October recap" }).click();
  await expect(banner(page)).toHaveCount(0);
  await navigate(page, "Home");
  await expect(page.getByRole("region", { name: "Left to spend" })).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
  expect(await page.evaluate(() => (JSON.parse(localStorage.getItem("penny.preferences") ?? "{}") as { recapDismissed?: string }).recapDismissed)).toBe("2026-10");
  expect(errors).toEqual([]);

  // A reload ends the demo (the sign-in screen’s 401 is expected); the dismissal is kept on this device.
  await page.goto("/");
  await enterDemo(page);
  await expect(page.getByRole("region", { name: "Left to spend" })).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
});

test("after the first 7 days of a month there is no banner, and the Recap button still opens any past month", async ({ page }) => {
  await startDemo(page, new Date("2026-11-10T15:00:00"));
  const errors = watchForErrors(page);
  await expect(page.getByRole("region", { name: "Left to spend" })).toBeVisible();
  await expect(page.getByRole("region", { name: /recap is ready/ })).toHaveCount(0);
  await navigate(page, "Insights");
  await expect(page.getByRole("region", { name: /recap is ready/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Recap", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "October recap" })).toBeVisible();
  expect(errors).toEqual([]);
});

/** The keyframe transforms of every script animation running now. */
const transforms = (page: Page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .flatMap((animation) => (animation.effect instanceof KeyframeEffect ? animation.effect.getKeyframes() : []))
      .map((frame) => String(frame.transform ?? "")),
  );

test.describe("motion (docs/design/motion.md §7)", () => {
  test.skip(({ browserName, isMobile }) => browserName !== "chromium" || isMobile, "animation sampling is checked once, on chromium desktop");

  test("the totals count up with only the final value for assistive technology, the bars grow together, and the banner fades out", async ({ page }) => {
    await startDemo(page);
    await banner(page).getByRole("link", { name: "See recap" }).click();
    const spent = page.getByRole("region", { name: /^Spent( · your share)?$/ });
    // While it counts, the drawn digits are hidden and the final amount is what's read.
    await expect(spent.locator(".visually-hidden", { hasText: "$1,963.09" })).toHaveCount(1);
    expect(await transforms(page)).toContain("scaleX(0)");
    await expect(spent.locator(".visually-hidden", { hasText: "$1,963.09" })).toHaveCount(0);
    await expect(spent).toContainText("$1,963.09");

    await page.getByRole("link", { name: "Back to Insights" }).click();
    await banner(page).getByRole("button", { name: "Dismiss the October recap" }).click();
    const opacities = await page.evaluate(() =>
      document
        .getAnimations()
        .flatMap((animation) => (animation.effect instanceof KeyframeEffect && animation.effect.target instanceof Element && animation.effect.target.matches(".recap-banner") ? animation.effect.getKeyframes() : []))
        .map((frame) => String(frame.opacity ?? "")),
    );
    expect(opacities).toContain("0");
    await expect(banner(page)).toHaveCount(0);
  });

  test("with reduced motion, the recap shows its final numbers at once and nothing grows", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await startDemo(page);
    await banner(page).getByRole("link", { name: "See recap" }).click();
    const spent = page.getByRole("region", { name: /^Spent( · your share)?$/ });
    await expect(spent).toContainText("$1,963.09");
    await expect(page.locator(".money--counting")).toHaveCount(0);
    expect(await transforms(page)).not.toContain("scaleX(0)");
  });
});
