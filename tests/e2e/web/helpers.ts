import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

export const testPassword = "Playwright-money-2026!";

export function uniqueEmail() {
  return `playwright-${randomUUID()}@example.test`;
}

export async function signUp(page: Page, email = uniqueEmail()) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New here? Create an account" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(testPassword);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByText("Your money, at a glance.", { exact: true })).toBeVisible();
  return email;
}

export async function openAddEntry(page: Page) {
  await page.getByRole("button", { name: "Add entry", exact: true }).first().click();
  await expect(page.getByText("A little update.", { exact: true })).toBeVisible();
}

export async function chooseEntryOption(page: Page, label: "Category" | "Trip" | "Account", option: string) {
  await page.getByRole("button", { name: new RegExp(`^${label}:`) }).click();
  await page.getByRole("button", { name: option, exact: true }).click();
}

export async function openSettings(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Account settings" }).click();
  await expect(page.getByText("Your personal space", { exact: true })).toBeVisible();
}
