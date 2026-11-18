import { expect, test, type Page } from "@playwright/test";

// Home, Explore your month and Insights (MAZ-92) on the temporary demo (src/demo): its sample
// month is made up and in memory, and no request reaches the API. The clock is fixed so the sample
// dates, the totals and the two schedules on the month's last day are stable. Desktop and phone.

const NOV_10 = new Date("2026-11-10T15:00:00");

/** Collects console errors and warnings, page errors and failed requests for the whole test. */
function watchForErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") errors.push(`console.${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => errors.push(`requestfailed: ${request.url()}`));
  return errors;
}

const horizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function startDemo(page: Page) {
  await page.clock.setFixedTime(NOV_10);
  await page.route("/api/info", (route) => route.fulfill({ json: { name: "penny", version: "2.0.0-e2e" } }));
  await page.route("/api/auth/me", (route) => route.fulfill({ status: 401, json: { error: "Please sign in to continue." } }));
  await page.route("/api/auth/oidc", (route) => route.fulfill({ json: { enabled: false } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Take a look around with sample data" }).click();
  await expect(page.getByText("You're exploring a demo")).toBeVisible();
}

const hero = (page: Page) => page.getByRole("region", { name: "Left to spend" });
const explore = (page: Page) => page.getByRole("region", { name: "Explore your month" });

test("Home leads with recorded and projected remaining, then recent activity, with no console errors", async ({ page }) => {
  await startDemo(page);
  // Watched from here: the 401 that shows the sign-in screen before the demo is expected.
  const errors = watchForErrors(page);
  // 5,450.00 came in − 1,883.35 spent − 200.00 invested.
  await expect(hero(page).locator(".hero__amount")).toHaveText("Recorded remaining: $3,366.65");
  // + 400.00 expected retainer − 45.00 phone plan.
  await expect(hero(page)).toContainText("$3,721.65 projected remaining · includes $400.00 expected income and $45.00 scheduled to go out");
  await expect(page.getByRole("region", { name: "Coming up" })).toContainText("Design retainer");
  await expect(page.getByRole("region", { name: "Recent" }).getByRole("listitem")).toHaveCount(5);
  await expect(explore(page).getByRole("heading", { name: "Explore your month" })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

/** The page's region headings in document order (MAZ-174: what leads). */
const regionOrder = (page: Page) => page.locator("main section[aria-labelledby]").evaluateAll((sections) => sections.map((section) => document.getElementById(section.getAttribute("aria-labelledby") ?? "")?.textContent ?? ""));

test("Home leads with one number, then Follow your money, then Recent (MAZ-174)", async ({ page, isMobile }) => {
  await startDemo(page);
  const order = await regionOrder(page);
  if (isMobile) {
    // iphone-home: the hero alone (no tiles), the flow card, Recent; Coming up after them.
    expect(order.slice(0, 4)).toEqual(["Left to spend", "Follow your money", "Recent", "Coming up"]);
    await expect(hero(page).getByText("Came in")).toHaveCount(0);
  } else {
    // web-home: the hero and its tiles beside Coming up, then the Sankey beside By category.
    expect(order.slice(0, 5)).toEqual(["Left to spend", "Coming up", "Follow your money", "By category", "Recent"]);
    await expect(page.getByRole("banner").getByRole("button", { name: "Previous month" })).toBeVisible();
  }
});

test("the desktop dashboard shows the Sankey and By category without scrolling at 1440×900 (MAZ-174)", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop layout");
  await page.setViewportSize({ width: 1440, height: 900 });
  await startDemo(page);
  // The demo's banner isn't there for a signed-in person; leave it out of the measurement.
  const banner = (await page.locator(".app__column > .pk-banner").first().boundingBox())?.height ?? 0;
  const sankey = await page.getByRole("group", { name: "Money flow diagram" }).boundingBox();
  const categories = await page.getByRole("region", { name: "By category" }).getByRole("listitem").last().boundingBox();
  expect(sankey && sankey.y + sankey.height - banner).toBeLessThanOrEqual(900);
  expect(categories && categories.y + categories.height - banner).toBeLessThanOrEqual(900);
});

test("the money flow is chosen with the keyboard and announced", async ({ page, isMobile }) => {
  await startDemo(page);
  // Watched from here: the 401 that shows the sign-in screen before the demo is expected.
  const errors = watchForErrors(page);
  // The full flow is in Explore your month on phones and leads the desktop dashboard (MAZ-174).
  const flow = (isMobile ? explore(page) : page).getByRole("region", { name: "Follow your money" });
  // Phones get the stacked flow; wider cards the Sankey. Only one of them is ever shown.
  const view = flow.getByRole("group", { name: isMobile ? "Money flow" : "Money flow diagram" });
  await expect(view).toBeVisible();
  await expect(flow.getByRole("group", { name: isMobile ? "Money flow diagram" : "Money flow", exact: true })).toBeHidden();

  const salary = view.getByRole("button", { name: /^Came in: Salary/ });
  await salary.focus();
  await page.keyboard.press("Enter");
  await expect(salary).toHaveAttribute("aria-pressed", "true");
  await expect(flow.locator(".flow__focus")).toContainText("Salary $4,800.00 · 88% of what came in");

  await page.keyboard.press("ArrowDown");
  const freelance = view.getByRole("button", { name: /^Came in: Freelance/ });
  await expect(freelance).toBeFocused();
  await page.keyboard.press("Space");
  await expect(freelance).toHaveAttribute("aria-pressed", "true");
  await expect(salary).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Escape");
  await expect(freelance).toHaveAttribute("aria-pressed", "false");
  await expect(flow.locator(".flow__focus")).toHaveText("Nothing focused");

  // Clicking a node (its label on the Sankey) focuses it, and clicking it again clears it.
  const home = view.getByRole("button", { name: /^Went out: Home/ });
  // On the Sankey, click where the label is drawn. Playwright works out the click point of SVG
  // text wrongly on WebKit (it lands on the bare <svg>), while a real pointer at the label hits it.
  const clickNode = async () => {
    if (isMobile) {
      await home.click();
      return;
    }
    const label = home.locator("text").first();
    await label.scrollIntoViewIfNeeded();
    const box = await label.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.click(box.x, box.y);
  };
  await clickNode();
  await expect(home).toHaveAttribute("aria-pressed", "true");
  await clickNode();
  await expect(home).toHaveAttribute("aria-pressed", "false");

  await flow.getByText("Show as a table").click();
  const table = flow.getByRole("table", { name: "Money flow for November 2026" });
  // Recorded-only (MAZ-136): Left over is Left to spend; the expected $400.00 retainer is not in it.
  await expect(table.getByRole("row", { name: /Left over/ })).toContainText("$3,366.65");
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("totals stay put while the month's list is searched, and a day filters it", async ({ page }) => {
  await startDemo(page);
  const before = await hero(page).textContent();
  const list = explore(page).getByRole("region", { name: /^Entries/ });
  await list.getByRole("searchbox", { name: "Search this month" }).fill("groceries");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/q=groceries/);
  await expect(list.getByRole("status")).toHaveText("2 entries match. The month's totals above don't change with these filters.");
  expect(await hero(page).textContent()).toBe(before);

  await list.getByRole("button", { name: "Clear filters" }).click();
  const calendar = explore(page).getByRole("region", { name: "Calendar" });
  await expect(calendar.getByRole("button", { name: /^Monday, November 30/ })).toHaveAccessibleName("Monday, November 30: 2 expected or scheduled");
  await expect(calendar.getByRole("list", { name: "Legend" })).toContainText("Expected or scheduled");
  await calendar.getByRole("button", { name: /^Monday, November 30/ }).click();
  await expect(page).toHaveURL(/day=2026-11-30/);
  await expect(list).toContainText("Phone plan");
  await expect(list).toContainText("Scheduled");
  await page.keyboard.press("ArrowLeft");
  await expect(calendar.getByRole("button", { name: /^Sunday, November 29/ })).toBeFocused();
  expect(await hero(page).textContent()).toBe(before);

  // Back restores the previous filter.
  await page.goBack();
  await expect(page).not.toHaveURL(/day=/);
});

test("Insights compares the month and fits a 320px window", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await startDemo(page);
  // Watched from here: the 401 that shows the sign-in screen before the demo is expected.
  const errors = watchForErrors(page);
  await expect(hero(page).locator(".hero__amount")).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  await page.getByRole("link", { name: "Insights" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Insights" })).toBeVisible();
  // iphone-insights (MAZ-174): the donut and one month-over-month sentence, then the categories.
  const spending = page.getByRole("region", { name: "Spending" });
  await expect(spending).toContainText("$1,883.35Spent");
  await expect(spending).toContainText(/more than October|less than October|Same as October/);
  await expect(page.getByRole("region", { name: "Categories" }).getByRole("listitem").first()).toContainText("$1,450.00");
  await expect(page.getByRole("group", { name: "Money flow", exact: true })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("desktop Insights compares categories with last month and charts six months (MAZ-174)", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop layout");
  await page.setViewportSize({ width: 1440, height: 900 });
  await startDemo(page);
  const errors = watchForErrors(page);
  await page.getByRole("link", { name: "Insights" }).first().click();
  const table = page.getByRole("table", { name: /^Spending by category/ });
  await expect(table.getByRole("row", { name: /^Home/ })).toContainText("$1,450.00");
  const months = page.getByRole("region", { name: "Last 6 months" });
  await months.getByText("Show as a table").click();
  await expect(months.getByRole("row", { name: /^November 2026/ })).toContainText("$1,883.35");
  await expect(months.getByRole("row")).toHaveCount(7);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});
