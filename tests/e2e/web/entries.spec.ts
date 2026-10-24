import { expect, test } from "@playwright/test";
import { openAddEntry, signUp } from "./helpers";

test("expense creation, personal split, search, edit, and confirmed deletion work end to end", async ({ page }) => {
  await signUp(page);
  await openAddEntry(page);
  await page.getByLabel("Amount (CAD)").fill("84.00");
  await page.getByLabel("What was it for?").fill("Playwright dinner");
  await page.getByLabel("Note (optional)").fill("split with a friend");
  await page.getByRole("button", { name: "My amount", exact: true }).click();
  await page.getByLabel("Your amount (CAD)").fill("42.00");
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Edit Playwright dinner,.*42\.00/ })).toBeVisible();

  await page.getByRole("button", { name: "Transactions" }).click();
  await page.getByLabel("Search entries").fill("friend");
  const entry = page.getByRole("button", { name: /^Edit Playwright dinner,/ });
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page.getByText("Edit entry", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Amount (CAD)", { exact: true })).toHaveValue("84.00");
  await page.getByLabel("What was it for?").fill("Playwright dinner updated");
  await page.getByLabel("Your amount (CAD)").fill("45.00");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Edit Playwright dinner updated,.*45\.00/ })).toBeVisible();

  await page.getByRole("button", { name: /^Edit Playwright dinner updated,/ }).click();
  await page.getByRole("button", { name: "Delete entry", exact: true }).click();
  await page.getByRole("button", { name: "Delete this entry", exact: true }).click();
  await expect(page.getByText("No entries found.", { exact: true })).toBeVisible();
});

test("income and investment records support kind filters and direct month and year selection", async ({ page }) => {
  await signUp(page);

  await openAddEntry(page);
  await page.getByLabel("Income", { exact: true }).click();
  await page.getByLabel("Amount (CAD)").fill("5000.00");
  await page.getByLabel("Where did it come from?").fill("Historical salary");
  await page.getByLabel("Date").fill("2025-04-03");
  await page.getByRole("button", { name: "Add income", exact: true }).click();

  await openAddEntry(page);
  await page.getByLabel("Investment", { exact: true }).click();
  await page.getByLabel("Amount (CAD)").fill("300.00");
  await page.getByLabel("Where are you investing?").fill("TFSA contribution");
  await page.getByLabel("Date").fill("2025-04-04");
  await page.getByRole("button", { name: "Add investment", exact: true }).click();

  await page.getByRole("button", { name: "Transactions" }).click();
  await page.getByRole("button", { name: /^Choose month:/ }).click();
  await page.getByLabel("Year").fill("2025");
  await page.getByRole("button", { name: "Apr", exact: true }).click();
  await page.getByRole("button", { name: "Apply period", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Edit Historical salary,/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Edit TFSA contribution,/ })).toBeVisible();

  await page.getByRole("button", { name: "By year", exact: true }).click();
  await expect(page.getByText("Totals for 2025", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Investments", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Edit TFSA contribution,/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Edit Historical salary,/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Income", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Edit Historical salary,/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Edit TFSA contribution,/ })).toHaveCount(0);

  await page.getByLabel("Search entries").fill("does not exist");
  await expect(page.getByText("No entries found.", { exact: true })).toBeVisible();
});

test("a PDF receipt uploads, remains attached after saving, and opens from the entry", async ({ page }) => {
  await signUp(page);
  await openAddEntry(page);
  await page.getByLabel("Amount (CAD)").fill("18.75");
  await page.getByLabel("What was it for?").fill("Receipt backed expense");

  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose file", exact: true }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "playwright-receipt.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF"),
  });
  await expect(page.getByText("playwright-receipt.pdf", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  const entry = page.getByRole("button", { name: /^Edit Receipt backed expense,/ });
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page.getByRole("button", { name: "View receipt", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View receipt", exact: true }).click();
  await expect(page.getByRole("button", { name: "Back to entry", exact: true })).toBeVisible();
});
