import type { Page } from "@playwright/test";

/**
 * Opens Settings the way a person would on this layout: the sidebar's Settings link on tablets
 * and desktops, or More › Settings from the tab bar on phones.
 */
export async function openSettings(page: Page) {
  // Wait for the shell, so the layout check below sees the real page.
  await page.getByRole("heading", { level: 1 }).waitFor();
  const more = page.getByRole("navigation", { name: "Tabs" }).getByRole("button", { name: "More" });
  if (await more.isVisible()) {
    await more.click();
    await page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Settings" }).click();
  } else {
    await page.getByRole("link", { name: "Settings" }).click();
  }
  await page.getByRole("navigation", { name: "Settings sections" }).waitFor();
}

/** Settings › Account › Sign out, confirmed. */
export async function signOut(page: Page) {
  await openSettings(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("dialog", { name: "Sign out of Penny?" }).getByRole("button", { name: "Sign out" }).click();
}
