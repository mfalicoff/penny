import { expect, test } from "@playwright/test";
import { chooseEntryOption, openAddEntry, signUp } from "./helpers";

test("accounts and trips can be created, assigned, renamed, reassigned, and removed", async ({ page }) => {
  await signUp(page);

  await page.getByRole("button", { name: "Accounts" }).click();
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page.getByLabel("Account name").fill("Travel card");
  await page.getByRole("button", { name: "Credit card", exact: true }).click();
  await page.getByRole("button", { name: "Save account", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit account Travel card" })).toBeVisible();

  await page.getByRole("button", { name: "Trips" }).click();
  await page.getByRole("button", { name: "Create trip", exact: true }).click();
  await page.getByLabel("Trip name").fill("Playwright Montréal trip");
  await page.getByRole("button", { name: "Create trip", exact: true }).last().click();
  await page.getByRole("button", { name: "Open trip Playwright Montréal trip" }).click();
  await expect(page.getByText("No expenses assigned yet.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Add expense to trip", exact: true }).click();
  await page.getByLabel("Amount (CAD)").fill("320.00");
  await page.getByLabel("What was it for?").fill("Hotel for Montréal");
  await chooseEntryOption(page, "Account", "Use Travel card");
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await expect(page.getByText("YOUR SPENDING", { exact: true })).toBeVisible();
  await expect(page.getByText("$320.00", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit Hotel for Montréal" })).toBeVisible();

  await page.getByRole("button", { name: "Edit trip", exact: true }).click();
  await expect(page.getByRole("button", { name: "Trip has expenses", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Close dialog" }).click();

  await page.getByRole("button", { name: "Accounts" }).click();
  await page.getByRole("button", { name: "Edit account Travel card" }).click();
  await expect(page.getByRole("button", { name: "Account is in use", exact: true })).toBeDisabled();
  await page.getByLabel("Account name").fill("Travel card renamed");
  await page.getByRole("button", { name: "Save account", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit account Travel card renamed" })).toBeVisible();

  await page.getByRole("button", { name: "Transactions" }).click();
  await page.getByLabel("Search entries").fill("Hotel for Montréal");
  await page.getByRole("button", { name: /^Edit Hotel for Montréal,/ }).click();
  await chooseEntryOption(page, "Trip", "No trip");
  await chooseEntryOption(page, "Account", "Unassigned");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();

  await page.getByRole("button", { name: "Trips" }).click();
  await page.getByRole("button", { name: "Open trip Playwright Montréal trip" }).click();
  await expect(page.getByText("No expenses assigned yet.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit trip", exact: true }).click();
  await page.getByRole("button", { name: "Delete trip", exact: true }).click();
  await expect(page.getByText("Your next trip starts here.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Accounts" }).click();
  await page.getByRole("button", { name: "Edit account Travel card renamed" }).click();
  await page.getByRole("button", { name: "Delete unused account", exact: true }).click();
  await expect(page.getByText("Where your money lives.", { exact: true })).toBeVisible();
});

test("an account can be created inside an entry without losing the entry draft", async ({ page }) => {
  await signUp(page);
  await openAddEntry(page);
  await page.getByLabel("Amount (CAD)").fill("73.25");
  await page.getByLabel("What was it for?").fill("Entry-created wallet expense");
  await page.getByRole("button", { name: /^Account:/ }).click();
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page.getByLabel("Account name").fill("Coffee wallet");
  await page.getByRole("button", { name: "Cash", exact: true }).click();
  await page.getByRole("button", { name: "Save account", exact: true }).click();

  await expect(page.getByLabel("Amount (CAD)", { exact: true })).toHaveValue("73.25");
  await expect(page.getByLabel("What was it for?")).toHaveValue("Entry-created wallet expense");
  await expect(page.getByRole("button", { name: "Account: Coffee wallet" })).toBeVisible();
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  const savedEntry = page.getByRole("button", { name: /^Edit Entry-created wallet expense,/ });
  await expect(savedEntry).toBeVisible();
  await expect(savedEntry.getByText(/Coffee wallet/)).toBeVisible();
});

test("custom categories can be created, edited, protected while in use, and deleted after reassignment", async ({ page }) => {
  await signUp(page);
  await page.getByRole("button", { name: "Categories" }).click();
  await page.getByRole("button", { name: "New category", exact: true }).click();
  await page.getByLabel("Category name").fill("Integration travel");
  await page.getByRole("button", { name: "airplane", exact: true }).click();
  await page.getByRole("button", { name: "Save category", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit category Integration travel" })).toBeVisible();

  await page.getByRole("button", { name: "Edit category Integration travel" }).click();
  await page.getByLabel("Category name").fill("Integration travel renamed");
  await page.getByRole("button", { name: "Save category", exact: true }).click();

  await page.getByRole("button", { name: "Transactions" }).click();
  await openAddEntry(page);
  await page.getByLabel("Amount (CAD)").fill("54.00");
  await page.getByLabel("What was it for?").fill("Category assignment");
  await chooseEntryOption(page, "Category", "Integration travel renamed");
  await page.getByRole("button", { name: "Add expense", exact: true }).click();

  await page.getByRole("button", { name: "Categories" }).click();
  await page.getByRole("button", { name: "Edit category Integration travel renamed" }).click();
  await expect(page.getByRole("button", { name: "Category is in use", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Close dialog" }).click();

  await page.getByRole("button", { name: "Transactions" }).click();
  await page.getByLabel("Search entries").fill("Category assignment");
  await page.getByRole("button", { name: /^Edit Category assignment,/ }).click();
  await chooseEntryOption(page, "Category", "Food & drinks");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();

  await page.getByRole("button", { name: "Categories" }).click();
  await page.getByRole("button", { name: "Edit category Integration travel renamed" }).click();
  await page.getByRole("button", { name: "Delete unused category", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit category Integration travel renamed" })).toHaveCount(0);
});
