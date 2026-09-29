import { expect, test, type Locator, type Page } from "@playwright/test";
import { testPassword, uniqueEmail } from "./helpers";

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() =>
    Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - window.innerWidth,
  )).toBeLessThanOrEqual(1);
}

async function expectInsideViewport(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
}

async function signUpOnPhone(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New here? Create an account" }).click();
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel("Password").fill(testPassword);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByText("Overview", { exact: true })).toBeVisible();
}

for (const { width, height } of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
  test(`phone navigation and primary screens fit at ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page.getByRole("button", { name: "Take a look around with sample data" }).click();

    const primary = [
      ["Overview", "Overview"],
      ["Transactions", "Transactions"],
      ["Households", "Households"],
      ["Trips", "Trips"],
    ] as const;
    for (const [tab, heading] of primary) {
      const button = page.getByRole("button", { name: tab, exact: true });
      await expectInsideViewport(page, button);
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await button.click();
      await expect(page.getByText(heading, { exact: true }).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }

    const more = page.getByRole("button", { name: "More sections" });
    await expectInsideViewport(page, more);
    expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    for (const [tab, heading] of [["Recurring", "Recurring"], ["Categories", "Categories"], ["Accounts", "Accounts"]] as const) {
      await more.click();
      await expectInsideViewport(page, page.getByRole("button", { name: tab, exact: true }));
      await page.getByRole("button", { name: tab, exact: true }).click();
      await expect(page.getByText(heading, { exact: true }).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
  });
}

test("entry sheet and category picker stay usable at 320×568", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  await page.getByRole("button", { name: "Take a look around with sample data" }).click();
  await page.getByRole("button", { name: "Add entry" }).click();
  await expectInsideViewport(page, page.getByRole("button", { name: "Add expense", exact: true }));
  await page.getByRole("button", { name: /^Category:/ }).click();
  await expectInsideViewport(page, page.getByRole("button", { name: "Add category" }));
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "Close selection" }).click({ position: { x: 10, y: 10 } });
  await expectInsideViewport(page, page.getByRole("button", { name: "Add expense", exact: true }));
});

test("long household names keep detail actions inside a 320px screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await signUpOnPhone(page);
  await page.getByRole("button", { name: "Households" }).click();
  await page.getByRole("button", { name: "Create household" }).click();
  const longName = "A household name long enough to test the narrow phone layout";
  await page.getByLabel("Household name").fill(longName);
  await page.getByRole("button", { name: "Create household" }).last().click();

  await expectInsideViewport(page, page.getByText(longName, { exact: true }));
  for (const label of ["Manage household", "Add expense", "Previous month", "Next month", "Recurring expenses"]) {
    await expectInsideViewport(page, page.getByRole("button", { name: label }));
  }
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "Manage household" }).click();
  await expectInsideViewport(page, page.getByRole("button", { name: "Invite member" }));
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Previous month" }).click();
  await expectNoHorizontalOverflow(page);
});
