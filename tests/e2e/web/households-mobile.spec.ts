import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test("household essentials and management remain usable on a narrow phone", async ({ page }) => {
  await signUp(page);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.getByRole("button", { name: "Households" }).click();
  await expect(page.getByRole("button", { name: "Create household" })).toBeVisible();
  await page.getByRole("button", { name: "Create household" }).click();
  await page.getByLabel("Household name").fill("Our home");
  await page.getByRole("button", { name: "Create household" }).last().click();

  await expect(page.getByText("Our home", { exact: true })).toBeVisible();
  await expect(page.getByText("Balances", { exact: true })).toBeVisible();
  await expect(page.getByText("Expenses", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Recurring expenses" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

  await page.getByRole("button", { name: "Manage household" }).click();
  await expect(page.getByRole("button", { name: "Invite member" })).toBeVisible();
  await expect(page.getByRole("button", { name: "View household activity" })).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Recurring expenses" }).click();
  await expect(page.getByText("No recurring expenses yet.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();

  await page.getByRole("button", { name: "Add expense" }).click();
  await expect(page.getByText("Your part of the receipt", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Expense for", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Expense for Our home", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Personal", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.getByLabel("Amount (CAD)").fill("42.00");
  await page.getByLabel("What was it for?").fill("Groceries");
  await page.getByRole("button", { name: /^Category:/ }).click();
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  await page.getByLabel("Category name").fill("Shared groceries");
  await page.getByRole("button", { name: "Save category", exact: true }).click();
  await expect(page.getByRole("button", { name: "Category: Shared groceries" })).toBeVisible();
  await page.getByRole("button", { name: "Add expense", exact: true }).last().click();
  await expect(page.getByRole("button", { name: "Edit Groceries" })).toBeVisible();
  await page.getByRole("button", { name: "More actions for Groceries" }).click();
  await expect(page.getByRole("button", { name: "Change history" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
