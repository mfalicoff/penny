import { expect, test } from "@playwright/test";
import { openAddEntry, signUp } from "./helpers";

async function addRecurringExpense(page: import("@playwright/test").Page, title: string, cadence: "Weekly" | "Monthly" | "Yearly") {
  await openAddEntry(page);
  await page.getByLabel("Amount (CAD)").fill("15.00");
  await page.getByLabel("What was it for?").fill(title);
  await page.getByRole("button", { name: cadence, exact: true }).click();
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
}

test("weekly, monthly, and yearly schedules can be edited, paused, resumed, and removed", async ({ page }) => {
  await signUp(page);
  await addRecurringExpense(page, "Weekly coffee", "Weekly");
  await addRecurringExpense(page, "Monthly utility", "Monthly");
  await addRecurringExpense(page, "Yearly renewal", "Yearly");

  await page.getByRole("button", { name: "Recurring" }).click();
  await expect(page.getByText("Weekly coffee", { exact: true })).toBeVisible();
  await expect(page.getByText("Monthly utility", { exact: true })).toBeVisible();
  await expect(page.getByText("Yearly renewal", { exact: true })).toBeVisible();

  const weeklyCard = page.getByText("Weekly coffee", { exact: true }).locator("xpath=../../..");
  await weeklyCard.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(weeklyCard.getByText("PAUSED", { exact: true })).toBeVisible();
  await weeklyCard.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(weeklyCard.getByRole("button", { name: "Pause", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Edit Monthly utility schedule", exact: true }).click();
  await page.getByLabel("What was it for?").fill("Updated monthly utility");
  await page.getByLabel("Amount (CAD)").fill("25.00");
  await page.getByRole("button", { name: "Weekly", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Updated monthly utility", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Delete Yearly renewal schedule", exact: true }).click();
  await page.getByRole("button", { name: "Remove schedule", exact: true }).click();
  await expect(page.getByText("Yearly renewal", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Transactions" }).click();
  await page.getByLabel("Search entries").fill("Yearly renewal");
  await expect(page.getByRole("button", { name: /^Edit Yearly renewal,/ })).toBeVisible();
  await page.getByLabel("Search entries").fill("Monthly utility");
  await expect(page.getByRole("button", { name: /^Edit Monthly utility,/ })).toBeVisible();
});
