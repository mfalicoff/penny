import type { Page } from "@playwright/test";

/**
 * Opens Settings the way a person would on this layout: the sidebar's Settings link on tablets
 * and desktops, or the Home tab's settings button on phones (MAZ-221).
 */
export async function openSettings(page: Page) {
  // Wait for the shell, so the layout check below sees the real page.
  await page.getByRole("heading", { level: 1 }).waitFor();
  const tabs = page.getByRole("navigation", { name: "Tabs" });
  if (await tabs.isVisible()) {
    await tabs.getByRole("link", { name: "Home", exact: true }).click();
    await page.getByRole("heading", { level: 1, name: "Home", exact: true }).waitFor();
  }
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("navigation", { name: "Settings sections" }).waitFor();
}

/** Settings › Sign out, confirmed. */
export async function signOut(page: Page) {
  await openSettings(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("dialog", { name: "Sign out of Penny?" }).getByRole("button", { name: "Sign out" }).click();
}
