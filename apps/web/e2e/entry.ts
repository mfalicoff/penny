import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Add entry follows a different card at each width (MAZ-226): phones (`iphone-add-expense`) keep
 * Receipt, Repeat, Trip and Note under "Receipt, repeat, trip"; touch tablets and narrow windows
 * (`ipad-add-entry`) list Repeat and Trip as rows and the receipt behind a Receipt row; desktops
 * (`web-add-entry`) list Repeat and Trip as rows with the receipt drop zone below them.
 */

/** The primary button: "Add expense" (or income, investment) for a new entry, "Save" for an edit. */
export const SAVE = /^(Save|Add (expense|income|investment))/;

/** The desktop layout (`web-add-entry`): from 1100px with a fine pointer. */
export const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1100;

/** The receipt's photo button: the desktop drop zone has only "browse" (a file or PDF). */
export const photoButton = (page: Page, replacing = false) =>
  isDesktop(page) ? (replacing ? "Replace with a file or PDF" : "Attach a file or PDF") : replacing ? "Replace with a photo" : "Attach a photo";

async function expand(button: Locator) {
  if ((await button.count()) && (await button.getAttribute("aria-expanded")) === "false") await button.click();
}

/** Shows the receipt, repeat, trip and note controls wherever this width keeps them. */
export async function openExtras(form: Locator) {
  await expand(form.getByRole("button", { name: /^Receipt, repeat, trip/ }));
  await expand(form.getByRole("button", { name: /^Receipt / }));
}

/** Chooses a trip ("" or null for none): a menu on tablets and desktops, a list on phones. */
export async function chooseTrip(form: Locator, trip: string | null) {
  const menu = form.getByRole("combobox", { name: "Trip" });
  if (await menu.count()) {
    await menu.selectOption(trip ? { label: trip } : "");
    return;
  }
  await openExtras(form);
  await form.getByRole("group", { name: "Trip" }).getByRole("radio", { name: trip ?? "No trip" }).check();
}

/** The trip the form has chosen. */
export async function expectTrip(form: Locator, trip: string) {
  const menu = form.getByRole("combobox", { name: "Trip" });
  if (await menu.count()) await expect(menu.locator("option:checked")).toHaveText(trip);
  else await expect(form.getByRole("group", { name: "Trip" }).getByRole("radio", { name: trip })).toBeChecked();
}
