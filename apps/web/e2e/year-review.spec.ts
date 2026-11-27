import type { Page } from "@playwright/test";
import { enterDemo, horizontalOverflow, navigate } from "./demo";
import { expect, test } from "./test";

// The year in review (MAZ-292 phase 2; cards web-insights-year-review, web-year-review,
// web-year-review-share, web-year-review-share-amounts) on the temporary demo (src/demo): from
// December 26 to January 31 its sample data fills the year, with a ski weekend in February and
// shared expenses in the Apartment, one paid by a former member. The clock is fixed so the sample
// dates and totals are stable. Desktop and phone.

const DEC_28 = new Date("2026-12-28T15:00:00");
const JAN_3 = new Date("2027-01-03T15:00:00");

function watchForErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") errors.push(`console.${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

async function startDemo(page: Page, day: Date) {
  await page.clock.setFixedTime(day);
  await page.route("/api/info", (route) => route.fulfill({ json: { name: "penny", version: "2.0.0-e2e" } }));
  await page.route("/api/auth/me", (route) => route.fulfill({ status: 401, json: { error: "Please sign in to continue." } }));
  await page.route("/api/auth/oidc", (route) => route.fulfill({ json: { enabled: false, providers: [] } }));
  await page.goto("/");
  await enterDemo(page);
}

const yearCard = (page: Page) => page.getByRole("region", { name: "Your year in Penny" });

async function openYear(page: Page) {
  await navigate(page, "Insights");
  await yearCard(page).getByRole("link", { name: "Open your year" }).click();
  await expect(page).toHaveURL(/\/insights\/year-review\?year=2026$/);
  await expect(page.getByRole("heading", { level: 1, name: "2026 in review" })).toBeVisible();
}

test("Insights offers the year from December 26, and the year shows categories, months, trips, who paid and facts", async ({ page }) => {
  await startDemo(page, DEC_28);
  const errors = watchForErrors(page);
  await navigate(page, "Insights");
  await expect(yearCard(page)).toContainText("2026 in review");
  await expect(yearCard(page)).toContainText("Top categories, trips, who paid and a few fun facts. Here until January 31.");
  await yearCard(page).getByRole("link", { name: "Open your year" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "2026 in review" })).toBeVisible();
  // The year control: 2026 is the latest year offered.
  await expect(page.getByRole("button", { name: "Next year" })).toBeDisabled();
  // Share your year takes Add entry's place.
  await expect(page.getByRole("button", { name: /Add entry/ })).toHaveCount(0);

  const lead = page.getByRole("region", { name: "Home took the biggest share of your year" });
  await expect(lead).toContainText("You spent $24,065 in 2026, your share of shared expenses included.");
  await expect(lead.getByRole("listitem")).toHaveCount(5);
  await expect(lead.getByRole("listitem").first()).toContainText("Home$17,72074%");

  const months = page.getByRole("region", { name: "Busiest month: February" });
  await expect(months).toContainText("$2,613 spent · the year averaged $2,005 a month");
  await expect(months.getByRole("listitem")).toHaveCount(12);
  await expect(months.getByRole("listitem").nth(1)).toContainText("February: $2,613, the busiest month");

  const trips = page.getByRole("region", { name: "1 trip, 3 days away" });
  await expect(trips).toContainText("Ski weekendFeb 13–15 · only you$5803 days");

  const paid = page.getByRole("region", { name: "Who paid" });
  await expect(paid).toContainText("20 shared expenses");
  // Initials avatars before the names: JM for Jules, the demo's own for You.
  await expect(paid.getByRole("listitem")).toHaveText([/Jules Moreau10$/, /You9$/, "Former member1"]);
  await expect(paid).not.toContainText("@");
  await expect(paid).toContainText("Counted by who paid, in Apartment. Others paid $1,544 of the ones you split.");

  const facts = page.getByRole("region", { name: "A few things about your year" });
  await expect(facts.getByRole("listitem")).toHaveText(["262days without spending", "13 dayslongest run without spending, in December", "103expenses recorded, about 2 a week", "Sundaythe day you spent the most"]);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("a year with nothing recorded says so, with Add an entry and Choose another year", async ({ page }) => {
  await startDemo(page, DEC_28);
  const errors = watchForErrors(page);
  await openYear(page);
  await page.getByRole("button", { name: "Previous year" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "2025 in review" })).toBeVisible();
  await expect(page).toHaveURL(/year=2025$/);
  const empty = page.getByRole("region", { name: "Nothing to review yet" });
  await expect(empty).toContainText("A year in review needs at least one recorded entry, and 2025 has none.");
  // Nothing to share in an empty year.
  await expect(page.getByRole("button", { name: "Share your year" })).toHaveCount(0);
  await empty.getByRole("button", { name: "Choose another year" }).click();
  await expect(page.getByRole("button", { name: "Previous year" })).toBeFocused();
  expect(errors).toEqual([]);
});

test("Share your year makes the image in the browser, hides amounts and names by default, and copies or downloads it", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "image clipboard permissions are granted in Chromium");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await startDemo(page, DEC_28);
  const errors = watchForErrors(page);
  await openYear(page);
  const requests: string[] = [];
  page.on("request", (request) => {
    if (!/^(blob|data):/.test(request.url())) requests.push(request.url());
  });

  await page.getByRole("button", { name: "Share your year" }).click();
  const dialog = page.getByRole("dialog", { name: "Share your year" });
  const image = dialog.getByRole("img", { name: /^Your share image/ });
  await expect(image).toBeVisible();
  const toggle = dialog.getByRole("switch", { name: "Show amounts and names" });
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toHaveAccessibleDescription("Only percentages, rankings and counts");
  await expect(dialog).toContainText("Penny makes this image in your browser and uploads nothing.");
  await expect(dialog).toContainText("PNG, 1080 × 1920");
  // What the image says, read from its text alternative: no amounts and no names.
  const hidden = (await image.getAttribute("alt")) ?? "";
  expect(hidden).toContain("My 2026. Where my money went. 1 Home 74%");
  expect(hidden).toContain("I paid for 45% of our shared expenses");
  expect(hidden).not.toMatch(/\$|Jules|Former member|Ski weekend|Apartment/);
  expect(await image.evaluate((element: HTMLImageElement) => [element.naturalWidth, element.naturalHeight])).toEqual([1080, 1920]);

  await toggle.check();
  await expect(toggle).toHaveAccessibleDescription("Amounts and who paid are on the image");
  await expect(image).toHaveAttribute("alt", /\$24,065 spent/);
  const shown = (await image.getAttribute("alt")) ?? "";
  expect(shown).toContain("Jules paid 10 · I paid 9 of our shared expenses · Former member 1");
  expect(shown).toContain("February busiest month · $2,613");
  expect(shown).not.toMatch(/Ski weekend|Apartment|Moreau|@/);

  await dialog.getByRole("button", { name: "Copy image" }).click();
  // The saved toast, and the dialog's own announcement (the toast is behind the modal dialog).
  await expect(page.getByText("Image copied", { exact: true }).first()).toBeVisible();
  await expect(dialog.getByRole("status")).toHaveText("Image copied");
  const copied = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((item) => item.types));
  expect(copied).toContain("image/png");

  const saved = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download" }).click();
  expect((await saved).suggestedFilename()).toBe("penny-2026.png");
  // Nothing went over the network.
  expect(requests).toEqual([]);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Share your year" })).toBeFocused();
  expect(errors).toEqual([]);
});

test("in January the year banner takes the December recap banner's place until it's dismissed", async ({ page }) => {
  await startDemo(page, JAN_3);
  const errors = watchForErrors(page);
  const year = page.getByRole("region", { name: "Your 2026 in review is ready" });
  const recap = page.getByRole("region", { name: "Your December recap is ready" });
  await expect(year).toContainText("Top categories, trips, who paid and a few fun facts.");
  await expect(recap).toHaveCount(0);

  await year.getByRole("button", { name: "Dismiss the 2026 year in review" }).click();
  await expect(year).toHaveCount(0);
  await expect(recap).toBeVisible();
  expect(await page.evaluate(() => (JSON.parse(localStorage.getItem("penny.preferences") ?? "{}") as { yearReviewDismissed?: string }).yearReviewDismissed)).toBe("2026");

  await navigate(page, "Insights");
  await expect(year).toHaveCount(0);
  await expect(recap).toBeVisible();
  // The Insights card stays for the whole window.
  await yearCard(page).getByRole("link", { name: "Open your year" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "2026 in review" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("in January the year banner opens the year", async ({ page }) => {
  await startDemo(page, JAN_3);
  const errors = watchForErrors(page);
  await page.getByRole("region", { name: "Your 2026 in review is ready" }).getByRole("link", { name: "Open your year" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "2026 in review" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("outside December 26 to January 31 there is no year card or banner", async ({ page }) => {
  await startDemo(page, new Date("2026-12-20T15:00:00"));
  const errors = watchForErrors(page);
  await navigate(page, "Insights");
  await expect(yearCard(page)).toHaveCount(0);
  await expect(page.getByRole("region", { name: /in review is ready/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test.describe("motion (docs/design/motion.md §7)", () => {
  test.skip(({ browserName, isMobile }) => browserName !== "chromium" || isMobile, "animation sampling is checked once, on chromium desktop");

  test("the year's total counts up with only the final value for assistive technology, and the bars and columns grow", async ({ page }) => {
    await startDemo(page, DEC_28);
    await openYear(page);
    const lead = page.getByRole("region", { name: "Home took the biggest share of your year" });
    await expect(lead.locator(".visually-hidden", { hasText: "$24,065" })).toHaveCount(1);
    const transforms = await page.evaluate(() =>
      document
        .getAnimations()
        .flatMap((animation) => (animation.effect instanceof KeyframeEffect ? animation.effect.getKeyframes() : []))
        .map((frame) => String(frame.transform ?? "")),
    );
    expect(transforms).toContain("scaleX(0)");
    expect(transforms).toContain("scaleY(0)");
    await expect(lead.locator(".visually-hidden", { hasText: "$24,065" })).toHaveCount(0);
    await expect(lead).toContainText("You spent $24,065");
  });

  test("with reduced motion, the year shows its final numbers at once and nothing grows", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await startDemo(page, DEC_28);
    await openYear(page);
    await expect(page.getByRole("region", { name: "Home took the biggest share of your year" })).toContainText("You spent $24,065");
    const transforms = await page.evaluate(() =>
      document
        .getAnimations()
        .flatMap((animation) => (animation.effect instanceof KeyframeEffect ? animation.effect.getKeyframes() : []))
        .map((frame) => String(frame.transform ?? "")),
    );
    expect(transforms).not.toContain("scaleX(0)");
  });
});
