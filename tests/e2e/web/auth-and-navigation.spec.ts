import { expect, test } from "@playwright/test";
import { openSettings, signUp, testPassword } from "./helpers";

test("registration, server sync, sign out, and sign in preserve the ledger", async ({ page }) => {
  const email = await signUp(page);

  await page.getByRole("button", { name: "Add entry", exact: true }).click();
  await page.getByLabel("Amount (CAD)").fill("2400.00");
  await page.getByLabel("What was it for?").fill("Pipeline expense");
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Edit Pipeline expense,/ })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: /^Edit Pipeline expense,/ })).toBeVisible();
  await openSettings(page);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(testPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Edit Pipeline expense,/ })).toBeVisible();
});

test("auth reports invalid credentials and lets the user retry", async ({ page }) => {
  const email = await signUp(page);
  await openSettings(page);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Wrong-password-123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Email or password is incorrect.", { exact: true })).toBeVisible();
  await page.getByLabel("Password").fill(testPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add entry", exact: true })).toBeVisible();
});

test("demo entry point, all feature routes, and compact navigation work", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Take a look around with sample data" }).click();
  await expect(page.getByText("Sample data · Have a look around.", { exact: true })).toBeVisible();

  const routes = [
    ["Transactions", "Your transactions."],
    ["Trips", "Your trips."],
    ["Recurring", "On repeat."],
    ["Categories", "Keep it organized."],
    ["Accounts", "Your accounts."],
    ["Overview", "Your money, at a glance."],
  ] as const;
  for (const [tab, heading] of routes) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await expect(page.getByText(heading, { exact: true })).toBeVisible();
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "More sections" })).toBeVisible();
  await page.getByRole("button", { name: "More sections" }).click();
  await page.getByRole("button", { name: "Accounts" }).click();
  await expect(page.getByText("Accounts", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Trips" }).click();
  await expect(page.getByText("Trips", { exact: true }).first()).toBeVisible();
  await page.getByText("Start my own tracker →", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
});

test("settings persist currency and appearance and enforce currency lock after entries", async ({ page }) => {
  await signUp(page);
  await openSettings(page);
  await page.getByRole("button", { name: "USD", exact: true }).click();
  await page.getByRole("radio", { name: "Dark theme" }).click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByText("USD", { exact: true }).first()).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Add entry", exact: true })).toBeVisible();
  await expect(page.getByText("USD", { exact: true }).first()).toBeVisible();
  await openSettings(page);
  await expect(page.getByRole("radio", { name: "Dark theme" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Close dialog" }).click();

  await page.getByRole("button", { name: "Add entry", exact: true }).click();
  await page.getByLabel("Amount (USD)").fill("10.00");
  await page.getByLabel("What was it for?").fill("Currency lock check");
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await openSettings(page);
  await expect(page.getByRole("button", { name: "CAD", exact: true })).toBeDisabled();
});
