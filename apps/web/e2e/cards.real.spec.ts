import { expect, test, type Browser, type Page } from "@playwright/test";
import { syntheticPng } from "./fixtures/receipts";
import { outputDirectory, redesign, resolveRefs, specimens, viewportFor, writeReport, type CardState, type ReportEntry, type Seed, type Status } from "./cards";
import { clearFaults, control, pinClock, realStack, seedScenario, skipReason } from "./stack";

// MAZ-122: the web app in the state of each of the 61 design cards (docs/design/penny-ios,
// contracts/design-baseline.json), against the real .NET API and PostgreSQL, so a reviewer can
// put every capture next to its baseline (docs/design/penny-ios/previews/<id>.<appearance>.png).
// Each card's data state comes from contracts/fixtures/redesign-states.json: its scenario and
// alias, the view, the appearances, and any fault or stale write. In apps/web:
//
//   npm run build && npm run test:e2e:cards                       # every card
//   npm run build && npm run test:e2e:cards -- --grep iphone-home # one card (and iphone-home-dark)
//
// Captures go to <repository>/test-results/cards/web/<id>.<appearance>.png (the viewport only, at
// device scale 2 like the previews, animations disabled, caret hidden) with report.json: one row
// per card and appearance, `captured`, `not-built`, `blocked` or `not-applicable` with a note.
// Viewports: web 1440×900, iPad 1194×834 with touch, iPhone 402×874 (the app picks its phone
// layout by width). The browser runs in UTC with its clock pinned to the scenario's.
//
// It runs only with PENNY_CARDS=1 (set by `test:e2e:cards`), once, on chromium-desktop: it opens
// its own contexts per card, so other projects would only repeat it.
test.skip(!realStack, skipReason);
test.skip(process.env.PENNY_CARDS !== "1", "card captures run with PENNY_CARDS=1 (npm run test:e2e:cards)");
test.skip(({ browserName, isMobile }) => browserName !== "chromium" || isMobile, "card captures run once, on chromium-desktop");
test.describe.configure({ timeout: 120_000 });

const AT = redesign.clock;
const states = new Map(redesign.states.map((state) => [state.specimen, state]));

interface Run {
  page: Page;
  seed: Seed | null;
  state: CardState;
}

interface Card {
  /** Opens the view in the card's state; the capture follows. */
  open?: (run: Run) => Promise<unknown>;
  /** For cards the web doesn't draw: why. */
  skip?: { status: Exclude<Status, "captured" | "failed">; note: string };
  /** Needs its own seed because it changes server data. */
  fresh?: boolean;
  /** Arms its own faults (not the state's), so they are cleared after the capture. */
  faults?: boolean;
  /** How the web state differs from the card's, for the report. */
  note?: string;
}

// ---- Navigation through the app's own UI ----

async function home(page: Page, path = "/") {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: "Home", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Left to spend" })).toBeVisible();
}

/**
 * The recorded and projected totals of `alex-2026-10` on Home. The other two amounts are in the
 * hero's tiles on desktop and in the Follow your money card on phones (MAZ-174).
 */
async function expectAlexOctober(page: Page) {
  const totals = page.getByRole("region", { name: "Left to spend" });
  await expect(totals).toContainText("Recorded remaining: −$1,759.50");
  await expect(totals).toContainText("Projected remaining: −$1,807.50");
  const main = page.getByRole("main");
  await expect(main).toContainText("$1,259.50");
  await expect(main).toContainText("$500.00");
}

async function page(pageRef: Page, path: string, heading: string | RegExp) {
  await pageRef.goto(path);
  await expect(pageRef.getByRole("heading", { level: 1, name: heading })).toBeVisible();
}

async function activity(p: Page, month: string) {
  await page(p, `/transactions?month=${month}`, "Activity");
  await expect(p.getByRole("region", { name: "Search results" }).getByRole("status")).toHaveText(/transaction/);
}

/** The Add entry dialog, opened from Home (or from Activity in `month`). */
async function addEntry(p: Page, from: { activity: string } | null = null) {
  if (from) await activity(p, from.activity);
  else await home(p);
  await p.getByRole("button", { name: "Add entry" }).first().click();
  const dialog = p.getByRole("dialog", { name: "Add entry" });
  await expect(dialog.getByLabel("Title")).toBeVisible();
  return dialog;
}

/** The cards' expense draft: $74.40 Dinner with friends on Visa, the amount still being typed. */
async function draftDinner(dialog: ReturnType<Page["getByRole"]>) {
  await dialog.getByLabel("Title").fill("Dinner with friends");
  await dialog.getByLabel("Account").selectOption({ label: "Visa" });
  await dialog.getByLabel("Amount (CAD)").fill("74.40");
}

async function moreDetails(p: Page) {
  const dialog = await addEntry(p);
  await dialog.getByRole("button", { name: /^More details/ }).click();
  await expect(dialog.getByRole("group", { name: "Your share" })).toBeVisible();
  return dialog;
}

/** Opens a personal entry's detail from Activity: a dialog on phones, the panel beside the list from 1100px (MAZ-225). */
async function entryDetail(p: Page, month: string, row: RegExp, title: string) {
  await activity(p, month);
  await p.getByRole("button", { name: row }).click();
  const detail = p.getByRole("dialog", { name: title }).or(p.getByRole("complementary", { name: title }));
  await expect(detail.getByRole("button", { name: "Edit" })).toBeVisible();
  return detail;
}

const partyDetail = (p: Page) => entryDetail(p, "2026-09", /^🎉 Party supplies/, "🎉 Party supplies");

function household(run: Run, ref: string) {
  const id = run.seed?.households[ref];
  if (!id) throw new Error(`No seeded household ${ref}`);
  return id;
}

async function maison(run: Run, query = "") {
  await page(run.page, `/households/${household(run, "maison")}${query}`, "Maison");
}

async function lisbon(run: Run) {
  await page(run.page, `/trips/${household(run, "lisbon")}`, "Lisbon trip");
}

/** Bea opens Internet in Maison and starts recording Alex's share as paid. */
async function recordAlexShare(run: Run) {
  await maison(run);
  await run.page.getByRole("list", { name: "Expenses" }).getByRole("link", { name: /^Internet/ }).click();
  const dialog = run.page.getByRole("dialog", { name: "Internet" });
  const alex = run.seed?.users.alex?.email ?? "";
  await dialog.getByRole("button", { name: `Mark ${alex}'s share as paid` }).click();
  const confirm = dialog.getByRole("button", { name: "Mark $40.00 as paid" });
  await expect(confirm).toBeVisible();
  return { dialog, confirm };
}

/**
 * Focuses one band of the Money flow diagram, as the cards draw it (MAZ-235): the node's button
 * is named "Went out: <label>, …". By keyboard: a thin band's label sits under its neighbour's
 * hit ring, so a click there can land on the neighbour.
 */
async function focusFlow(p: Page, label: string) {
  const node = p.getByRole("group", { name: "Money flow diagram" }).getByRole("button", { name: new RegExp(`^Went out: ${label},`) });
  await node.focus();
  await p.keyboard.press("Enter");
  await expect(node).toHaveAttribute("aria-pressed", "true");
  // The cards show the selection, not the keyboard focus ring.
  await node.blur();
}

/** A pointer over a band, as `web-home` draws Groceries hovered: the band is emphasised, not selected (MAZ-223). */
async function hoverFlow(p: Page, label: string) {
  const node = p.getByRole("group", { name: "Money flow diagram" }).getByRole("button", { name: new RegExp(`^Went out: ${label},`) });
  await node.locator(".flow-node__label").hover();
  await expect(node).toHaveClass(/flow-node--lit/);
  await expect(node).toHaveAttribute("aria-pressed", "false");
}

/**
 * Two changes the server hasn't taken, as on the sign-out card (and the iOS capture): every ledger
 * sync is dropped while Coffee to go and Groceries are added on this device.
 */
const DROP_LEDGER_SYNC = { target: "http", method: "PUT", pathPrefix: "/api/ledger", abort: true };
async function makeTwoPendingChanges(p: Page) {
  await control("PUT", "faults", { rules: [DROP_LEDGER_SYNC] });
  await home(p);
  for (const [amount, title] of [["3.00", "Coffee to go"], ["48.90", "Groceries"]] as const) {
    await p.getByRole("button", { name: "Add entry" }).first().click();
    const dialog = p.getByRole("dialog", { name: "Add entry" });
    await dialog.getByLabel("Amount (CAD)").fill(amount);
    await dialog.getByLabel("Title").fill(title);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await dismissToast(p);
  }
  await expect(p.getByText("2 changes waiting").first()).toBeVisible();
}

async function scrollTo(p: Page, locator: ReturnType<Page["locator"]>) {
  await expect(locator).toBeVisible();
  await locator.evaluate((element) => {
    element.scrollIntoView({ block: "start" });
  });
}

async function signInScreen(p: Page) {
  await p.goto("/");
  await expect(p.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();
}

/**
 * Edits p-coffee-2 (the scenario's pending edit: Coffee → Espresso) with a 503 armed on the next
 * ledger sync, then returns to Home (the cards' page) without moving the pointer, so it keeps
 * holding the "Changes saved" toast and its Undo (a hovered toast stays up to 30 s). On phones the
 * tab bar is hidden while a toast shows (MAZ-166), so its Home link takes neither a real click nor
 * focus: the link is clicked inside the page, which runs the router's own navigation (MAZ-220).
 */
async function editWithFailingSync(run: Run) {
  const detail = await entryDetail(run.page, "2026-10", /^Coffee Personal · Groceries & dining · Fri, Oct 9/, "Coffee");
  await detail.getByRole("button", { name: "Edit" }).click();
  const form = run.page.getByRole("dialog", { name: "Edit entry" });
  await form.getByLabel("Title").fill("Espresso");
  await armFault(run);
  const sync = run.page.waitForResponse((response) => response.request().method() === "PUT" && new URL(response.url()).pathname === "/api/ledger");
  await form.getByRole("button", { name: "Save" }).click();
  expect((await sync).status(), "the armed fault answers the first sync").toBe(503);
  const banner = run.page.getByRole("status").filter({ hasText: "Not synced" });
  await expect(banner).toBeVisible();
  const toast = run.page.getByText("Changes saved", { exact: true });
  await toast.hover();
  const tabs = run.page.getByRole("navigation", { name: "Tabs", includeHidden: true });
  await tabs.getByRole("link", { name: "Home", exact: true, includeHidden: true }).evaluate((link: HTMLElement) => {
    link.click();
  });
  await expect(run.page.getByRole("heading", { level: 1, name: "Home", exact: true })).toBeVisible();
  await expect(run.page.getByRole("region", { name: "Recent" })).toContainText("Espresso");
  return { banner, toast };
}

async function armFault(run: Run) {
  const fault = run.state.fault;
  if (!fault) throw new Error(`${run.state.specimen} names no fault`);
  await control("PUT", "faults", { rules: [{ pathPrefix: "/", ...fault }] });
}

const NO_LOCK = "The web has no app lock by design (docs/reference/redesign.md, Access: the web uses the current origin and has no lock).";

const cards: Record<string, Card> = {
  "system-foundations": { skip: { status: "not-applicable", note: "Token and component sheet; checked by `npm run design:check`, not a screen." } },
  "system-widgets": { skip: { status: "not-applicable", note: "Home and Lock Screen widgets are native only; the card has no web owner." } },

  // Overview
  "iphone-home": {
    open: async ({ page: p }) => {
      await home(p);
      await expectAlexOctober(p);
    },
  },
  "iphone-home-dark": {
    open: async ({ page: p }) => {
      await home(p);
      await expectAlexOctober(p);
    },
  },
  "iphone-money-flow": {
    open: async ({ page: p }) => {
      await page(p, "/money-flow?month=2026-09", "Money flow");
      await expect(p.getByRole("group", { name: "Money flow diagram" })).toBeVisible();
      // The card focuses the largest spending band (Home; the scenario's Housing), with its focus card.
      await focusFlow(p, "Housing");
      await expect(p.getByRole("main").getByRole("button", { name: "Clear focus on Housing" })).toBeInViewport();
    },
  },
  "iphone-insights": {
    open: async ({ page: p }) => {
      await page(p, "/insights?month=2026-10", "Insights");
      await expect(p.getByRole("region", { name: "Categories" })).toBeVisible();
    },
  },
  "iphone-calendar": {
    open: async ({ page: p }) => {
      await home(p);
      await p.getByRole("banner").getByRole("button", { name: "Calendar" }).click();
      const sheet = p.getByRole("dialog");
      await expect(sheet.getByRole("table")).toBeVisible();
      // The card selects a past day with entries: Oct 3, the ETF purchase (as the iOS capture does).
      const day = sheet.getByRole("button", { name: /October 3:/ });
      await day.click();
      await expect(day).toHaveAttribute("aria-pressed", "true");
      await expect(sheet.getByRole("heading", { name: /Oct 3/ })).toBeVisible();
    },
  },
  "iphone-activity": { open: ({ page: p }) => activity(p, "2026-10") },
  "iphone-search-empty": {
    open: async ({ page: p, state }) => {
      // Narrowed to expenses in the month, as the card (and the iOS capture) shows it.
      await page(p, `/transactions?kind=expense&month=${state.month ?? "2026-10"}&q=${encodeURIComponent(state.search?.query ?? "zzzz")}`, "Activity");
      const results = p.getByRole("region", { name: "Search results" });
      await expect(results.getByRole("status")).toHaveText(/No matching/);
    },
  },

  // Add entry
  "iphone-add-expense": {
    open: async ({ page: p }) => {
      await draftDinner(await addEntry(p));
    },
    note: "A keyboard form in a dialog: no large amount or keypad.",
  },
  "iphone-add-income": {
    open: async ({ page: p }) => {
      const dialog = await addEntry(p);
      await dialog.getByRole("radio", { name: "Income" }).check({ force: true });
      await expect(dialog.getByRole("radio", { name: "Income" })).toBeChecked();
      // The card's pay, dated after the scenario's today (Oct 15), so it is expected (as on iOS).
      await dialog.getByLabel("Amount (CAD)").fill("3200.00");
      await dialog.getByLabel("Title").fill("Payday");
      await dialog.getByLabel("Date").fill("2026-10-30");
      await dialog.getByLabel("Account").selectOption({ label: "Everyday chequing" });
      await expect(dialog.getByLabel("Date")).toHaveValue("2026-10-30");
      await dialog.getByLabel("Date").blur();
      await scrollTo(p, dialog.getByText("Oct 30 is still ahead", { exact: false }));
    },
  },
  "iphone-entry-extras": {
    open: async ({ page: p }) => {
      const dialog = await moreDetails(p);
      // The card has a photo receipt attached (a synthetic PNG, as the iOS capture's photo).
      const chooser = p.waitForEvent("filechooser");
      await dialog.getByRole("button", { name: "Attach a photo" }).click();
      await (await chooser).setFiles({ name: "receipt.png", mimeType: "image/png", buffer: syntheticPng() });
      const receipt = dialog.getByRole("group", { name: "Receipt" });
      await expect(receipt.getByRole("button", { name: "Preview receipt.png" })).toBeVisible();
      await scrollTo(p, dialog.getByRole("group", { name: "Your share" }));
    },
    note: "More details expands inside the form (share, repeat, trip, note, receipt) instead of opening its own page.",
  },
  "iphone-split": {
    open: async ({ page: p }) => {
      const dialog = await moreDetails(p);
      await dialog.getByLabel("Amount (CAD)").fill("74.40");
      await dialog.getByLabel("Title").fill("Dinner with friends");
      const share = dialog.getByRole("group", { name: "Your share" });
      // By keyboard: on a phone the dialog's sticky footer covers the group until it scrolls.
      await share.getByRole("radio", { name: "All mine" }).focus();
      await p.keyboard.press("ArrowRight");
      await expect(share.getByRole("radio", { name: "Split equally" })).toBeChecked();
      await scrollTo(p, share);
      // The card splits equally between 3 people (as the iOS capture does).
      await dialog.getByRole("textbox", { name: "Number of people" }).fill("3");
      await expect(dialog.getByRole("status").filter({ hasText: "Your share" })).toContainText("$24.80");
      await scrollTo(p, share);
    },
    note: "The draft amount and title are typed to match the card ($74.40, Dinner with friends); the split is in the form, not a separate page.",
  },
  "iphone-category-picker": {
    open: async ({ page: p }) => {
      const dialog = await addEntry(p);
      await dialog.getByRole("button", { name: "All categories" }).click();
      await expect(p.getByText("Groceries & dining").last()).toBeVisible();
    },
  },
  "iphone-entry-detail": { open: ({ page: p }) => partyDetail(p) },
  "iphone-receipt": {},
  "iphone-delete-confirm": {
    open: async (run) => {
      // The card deletes the shared Internet expense for everyone (as the iOS capture does).
      await maison(run);
      await run.page.getByRole("list", { name: "Expenses" }).getByRole("link", { name: /^Internet/ }).click();
      const dialog = run.page.getByRole("dialog", { name: "Internet" });
      await dialog.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(run.page.getByRole("dialog", { name: "Delete “Internet”?" }).getByRole("button", { name: "Delete for everyone" })).toBeVisible();
    },
    note: "The shared expense is opened from Maison's expenses; its delete confirmation is a centered dialog over it (MAZ-227).",
  },

  // Emailed receipts (MAZ-184): blocked by their state until the full-stack seed has a receipt
  // address and inbox items; they need an `open` here once it does.
  "iphone-receipt-inbox": {},
  "iphone-receipt-inbox-item": {},
  "iphone-receipt-attach-file": {},
  "iphone-receipt-attach-entry": {},
  "iphone-receipt-attach-confirm": {},
  "iphone-receipt-attached-toast": {},
  "iphone-receipt-email-settings": {},

  // Shared
  "iphone-shared-list": {
    open: async ({ page: p }) => {
      await page(p, "/households", "Shared");
      await expect(p.getByRole("link", { name: /^Maison/ })).toBeVisible();
    },
  },
  "iphone-shared": { open: (run) => maison(run) },
  "iphone-shared-balances": {
    open: async (run) => {
      await maison(run, `?tab=balances&month=${run.state.month ?? "2026-10"}`);
    },
  },
  "iphone-shared-people": { open: (run) => maison(run, "?tab=people") },
  "iphone-shared-expense-add": {
    open: async (run) => {
      await maison(run);
      await run.page.getByRole("button", { name: "Shared expense" }).click();
      const dialog = run.page.getByRole("dialog", { name: "Add entry" });
      await expect(dialog).toBeVisible();
      // The card's draft: $96.30 Hydro (as the iOS capture types it).
      await dialog.getByLabel("Title").fill("Hydro");
      await dialog.getByLabel("Amount (CAD)").fill("96.30");
    },
  },
  "iphone-record-payment": { open: (run) => recordAlexShare(run) },
  "iphone-payment-stale": {
    fresh: true,
    open: async (run) => {
      const { dialog, confirm } = await recordAlexShare(run);
      const write = run.state.staleWrite;
      const seed = run.seed;
      if (!write || !seed) throw new Error("iphone-payment-stale needs its stale write and seed");
      const [first, second] = write.requests;
      if (!first || !second) throw new Error("iphone-payment-stale names two requests");
      // The other device records the payment first, with the revision both devices read.
      const path = resolveRefs(write.path, seed);
      const other = await run.page.request.fetch(path, { method: write.method, data: resolveRefs(first.body, seed) });
      expect(other.status(), "the first device's payment").toBe(first.expectStatus);
      // This browser then sends the same payment with the revision it read: refused.
      const refused = run.page.waitForResponse((response) => new URL(response.url()).pathname === path && response.request().method() === write.method);
      await confirm.click();
      const response = await refused;
      expect(response.status()).toBe(second.expectStatus);
      if (second.expectError) expect(((await response.json()) as { error?: string }).error).toBe(second.expectError);
      await expect(dialog.getByRole("alert")).toContainText("Nothing was recorded.");
      await expect(dialog.getByRole("button", { name: "Review expense" })).toBeVisible();
    },
    note: "The first device is an API call with Bea's session; this browser is the device that sends the stale payment.",
  },
  "iphone-household-create": {
    open: async ({ page: p }) => {
      await page(p, "/households", "Shared");
      await p.getByRole("button", { name: /^New household/ }).click();
      const dialog = p.getByRole("dialog", { name: "New household" });
      await dialog.getByLabel("Name").fill("Apartment");
      await dialog.getByLabel("Name").blur();
    },
  },
  "iphone-history": {
    open: async (run) => {
      await maison(run, "?tab=history");
      await expect(run.page.getByRole("heading", { name: /History/ }).first()).toBeVisible();
    },
  },

  // Trips
  "iphone-trips": {
    open: async ({ page: p }) => {
      await page(p, "/trips", "Trips");
      await expect(p.getByRole("link", { name: /Québec weekend/ })).toBeVisible();
    },
  },
  "iphone-trip-detail": { open: (run) => lisbon(run) },
  "iphone-trip-form": {
    open: async ({ page: p }) => {
      await page(p, "/trips", "Trips");
      await p.getByRole("button", { name: "New trip" }).first().click();
      const dialog = p.getByRole("dialog", { name: "New trip" });
      await expect(dialog).toBeVisible();
      // The card names the trip and turns sharing on (as the iOS capture does).
      await dialog.getByLabel("Trip name").fill("Lisbon");
      const share = dialog.getByRole("switch", { name: "Share with others" });
      await share.check();
      await expect(share).toBeChecked();
    },
  },

  // Settings and organize
  "iphone-settings": {
    open: ({ page: p }) => page(p, "/settings", "Settings"),
    note: "Settings is a page (Account, Appearance, Currency, Server), not a sheet; Recurring, Accounts and Categories are in More.",
  },
  "iphone-recurring": {
    open: async ({ page: p }) => {
      await page(p, "/recurring", "Recurring");
      await expect(p.getByRole("button", { name: /^Gym/ })).toBeVisible();
    },
  },
  "iphone-schedule-detail": {
    open: async ({ page: p }) => {
      await page(p, "/recurring", "Recurring");
      await p.getByRole("button", { name: /^Gym/ }).click();
      await expect(p.getByRole("dialog", { name: /Gym/ })).toBeVisible();
    },
  },
  "iphone-accounts": {
    open: async ({ page: p }) => {
      await page(p, "/accounts", "Accounts");
      await expect(p.getByRole("button", { name: "Edit Everyday chequing" })).toBeVisible();
    },
  },
  "iphone-account-form": {
    open: async ({ page: p }) => {
      await page(p, "/accounts", "Accounts");
      // The card edits Visa, which entries and schedules use, so Remove is locked.
      await p.getByRole("button", { name: "Edit Visa" }).click();
      const dialog = p.getByRole("dialog", { name: /account/i });
      await expect(dialog.getByText(/^Visa is used by /)).toBeVisible();
    },
  },
  "iphone-categories": {
    open: async ({ page: p }) => {
      await page(p, "/categories", "Categories");
      await expect(p.getByRole("button", { name: "Edit Groceries & dining" })).toBeVisible();
    },
  },
  "iphone-category-form": {
    open: async ({ page: p }) => {
      await page(p, "/categories", "Categories");
      await p.getByRole("button", { name: "New category" }).click();
      const dialog = p.getByRole("dialog", { name: /category/i });
      // The card's draft: Coffee, pink, with the cup icon (as the iOS capture types it).
      await dialog.getByLabel("Name").fill("Coffee");
      await dialog.getByRole("radio", { name: "Pink" }).check({ force: true });
      await dialog.getByRole("radio", { name: "Coffee" }).check({ force: true });
      await expect(dialog.getByRole("radio", { name: "Coffee" })).toBeChecked();
    },
  },
  "iphone-appearance": { open: ({ page: p }) => page(p, "/settings/appearance", /Appearance|Settings/) },
  "iphone-app-lock": { skip: { status: "not-applicable", note: NO_LOCK } },

  // Access
  "iphone-sign-in": { open: ({ page: p }) => signInScreen(p) },
  "iphone-create-account": {
    open: async ({ page: p }) => {
      await signInScreen(p);
      await p.getByRole("button", { name: "Create an account" }).click();
      await expect(p.getByRole("button", { name: /Create account/ })).toBeVisible();
    },
  },
  "iphone-server-connect": {
    skip: { status: "not-applicable", note: "The web always uses the server it was opened from; it has no signed-out server entry (Settings › Server shows it read-only when signed in)." },
  },
  "iphone-lock": { skip: { status: "not-applicable", note: NO_LOCK } },
  "iphone-empty-home": {
    open: async ({ page: p }) => {
      await p.goto("/");
      await expect(p.getByRole("heading", { level: 1, name: "Home", exact: true })).toBeVisible();
      await expect(p.getByRole("region", { name: "Add your first entry" })).toBeVisible();
    },
  },

  // Feedback
  "iphone-offline": {
    open: async (run) => {
      const p = run.page;
      await home(p);
      await armFault(run);
      // The scenario's pending create, so the banner has a change waiting (the web saves on
      // this device first and only then syncs).
      const dialog = (await p.getByRole("button", { name: "Add entry" }).first().click(), p.getByRole("dialog", { name: "Add entry" }));
      await dialog.getByLabel("Amount (CAD)").fill("3");
      await dialog.getByLabel("Title").fill("Coffee to go");
      await dialog.getByRole("button", { name: "Save" }).click();
      await expect(p.getByRole("status").filter({ hasText: "1 change waiting" })).toBeVisible();
      await dismissToast(p);
      // The pending row waits to sync, and Projected is what the last sync knew (MAZ-223).
      await expect(p.getByRole("region", { name: "Recent" }).getByRole("listitem").filter({ hasText: "Coffee to go" })).toContainText("Waiting to sync");
      await expect(p.locator(".hero__projected")).toContainText("projected · as of last sync");
    },
    note: "The web learns the server is unreachable when its sync fails: Coffee to go (the scenario's pending create) waits to sync, and the banner reads Offline · 1 change waiting with Retry.",
  },
  "iphone-save-error": {
    fresh: true,
    open: async (run) => {
      const { banner } = await editWithFailingSync(run);
      await dismissToast(run.page);
      await expect(banner).toBeVisible();
    },
    note: "The web saves on this device first, so the 503 is a failed sync (the edit is kept and waits), not a failed save in the form: Home shows the sync banner and Espresso waiting to sync, and the form has already closed.",
  },
  "iphone-saved-toast": {
    fresh: true,
    open: async (run) => {
      const { banner, toast } = await editWithFailingSync(run);
      const retried = run.page.waitForResponse((response) => response.request().method() === "PUT" && new URL(response.url()).pathname === "/api/ledger");
      await banner.getByRole("button", { name: "Retry" }).press("Enter");
      expect((await retried).status(), "the retry syncs").toBe(200);
      await expect(banner).toBeHidden();
      await expect(toast).toBeVisible();
    },
    note: "The toast is the edit's 'Changes saved' with Undo, still shown on Home after Retry in the sync banner synced it.",
  },
  "iphone-sign-out": {
    fresh: true,
    faults: true,
    open: async ({ page: p }) => {
      await makeTwoPendingChanges(p);
      await page(p, "/settings", "Settings");
      await p.getByRole("button", { name: "Sign out" }).click();
      const dialog = p.getByRole("dialog", { name: "2 changes haven’t synced" });
      await expect(dialog.getByRole("button", { name: "Sync, then sign out" })).toBeVisible();
    },
    note: "Ledger syncs are dropped to hold the two changes, so Settings shows the Offline banner behind the dialog.",
  },

  // iPad
  "ipad-home": {
    open: async ({ page: p }) => {
      await home(p);
      await expectAlexOctober(p);
    },
  },
  "ipad-activity": {
    open: ({ page: p }) => partyDetail(p),
  },
  "ipad-add-entry": { open: ({ page: p }) => addEntry(p) },
  "ipad-shared": { open: (run) => maison(run) },
  "ipad-trip": { open: (run) => lisbon(run) },
  "ipad-settings": { open: ({ page: p }) => page(p, "/settings", "Settings") },

  // Emailed receipts (MAZ-184): blocked by their state until the full-stack seed has a receipt
  // address and inbox items; they need an `open` here once it does.
  "ipad-receipt-inbox": {},
  "ipad-receipt-inbox-item": {},
  "ipad-receipt-attach-file": {},
  "ipad-receipt-attach-entry": {},
  "ipad-receipt-attach-confirm": {},
  "ipad-receipt-attached-toast": {},
  "ipad-receipt-email-settings": {},

  // Web
  "web-home": {
    open: async ({ page: p }) => {
      await home(p);
      await expectAlexOctober(p);
      // The card shows Groceries (the scenario's Groceries & dining) hovered in Follow your money.
      await hoverFlow(p, "Groceries & dining");
    },
  },
  "web-activity": {
    open: ({ page: p }) => partyDetail(p),
  },
  "web-insights": {
    open: async ({ page: p }) => {
      await page(p, "/insights?month=2026-09", "Insights");
      // The card focuses Home (the scenario's Housing), the largest band.
      await focusFlow(p, "Housing");
    },
  },
  "web-household": { open: (run) => maison(run, `?month=${run.state.month ?? "2026-10"}`) },
  "web-trips": {
    open: async ({ page: p }) => {
      await page(p, "/trips", "Trips");
      await expect(p.getByRole("heading", { name: "Lisbon trip" })).toBeVisible();
    },
  },
  "web-settings": { open: ({ page: p }) => page(p, "/settings", "Settings") },
  "web-add-entry": {
    open: async ({ page: p }) => {
      // The card opens the dialog over Activity, with its draft: $74.40 Dinner with friends on Visa.
      await draftDinner(await addEntry(p, { activity: "2026-10" }));
    },
  },
  "web-sign-in": { open: ({ page: p }) => signInScreen(p) },

  // Emailed receipts (MAZ-184): blocked by their state until the full-stack seed has a receipt
  // address and inbox items; they need an `open` here once it does.
  "web-receipt-inbox": {},
  "web-receipt-inbox-item": {},
  "web-receipt-attach-file": {},
  "web-receipt-attach-entry": {},
  "web-receipt-attach-confirm": {},
  "web-receipt-attached-toast": {},
  "web-receipt-email-settings": {},
};

async function dismissToast(p: Page) {
  const close = p.getByRole("button", { name: "Dismiss" });
  if (await close.count()) await close.first().click();
}

// ---- Seeds, contexts and captures ----

const seeds = new Map<string, Seed>();
function seedFor(state: CardState, fresh: boolean): Seed | null {
  if (!state.scenario || state.client) return null;
  if (fresh) return seedScenario(state.scenario) as Seed;
  let found = seeds.get(state.scenario);
  if (!found) {
    found = seedScenario(state.scenario) as Seed;
    seeds.set(state.scenario, found);
  }
  return found;
}

async function openContext(browser: Browser, baseURL: string | undefined, id: string, seed: Seed | null, state: CardState) {
  const viewport = viewportFor(id);
  if (!viewport) throw new Error(`No viewport for ${id}`);
  const context = await browser.newContext({
    ...(baseURL ? { baseURL } : {}),
    viewport,
    // The iPad cards show a touch tablet: the shell picks its iPad look (copper selection, glass
    // month buttons) from a coarse pointer without hover (MAZ-221).
    ...(id.startsWith("ipad-") ? { hasTouch: true } : {}),
    deviceScaleFactor: 2,
    timezoneId: "UTC",
    locale: "en-CA",
    colorScheme: state.appearances[0] ?? "light",
    reducedMotion: "reduce",
  });
  context.setDefaultTimeout(15_000);
  const p = await context.newPage();
  await p.clock.setFixedTime(AT);
  if (seed) {
    const user = state.as ? seed.users[state.as] : undefined;
    if (!user) throw new Error(`No seeded user ${String(state.as)}`);
    const response = await p.request.post("/api/auth/login", { data: { email: user.email, password: user.password } });
    expect(response.status(), `sign in ${String(state.as)}`).toBe(200);
  }
  return { context, page: p, viewport };
}

const report: ReportEntry[] = [];

test.afterAll(async () => {
  writeReport(report);
  if (realStack && process.env.PENNY_CARDS === "1") {
    await clearFaults();
    await pinClock(null);
  }
});

for (const specimen of specimens) {
  const id = specimen.id;
  const state = states.get(id);
  const card = cards[id];

  test(id, async ({ browser, baseURL }) => {
    if (!state) throw new Error(`redesign-states.json has no state for ${id}`);
    if (!card) throw new Error(`cards.real.spec.ts has no entry for ${id}`);
    const viewport = viewportFor(id);
    const record = (appearance: ReportEntry["appearance"], status: Status, file: string | null, note: string) =>
      report.push({ id, appearance, status, file, viewport, view: state.view, note });

    const skip = state.client === "static" ? { status: "not-applicable" as const, note: card.skip?.note ?? "Static reference card." } : state.blockedBy ? { status: "blocked" as const, note: state.blockedBy } : card.skip;
    if (skip || !card.open) {
      const reason = skip ?? { status: "not-built" as const, note: "No web state is mapped for this card." };
      for (const appearance of state.appearances) record(appearance, reason.status, null, reason.note);
      test.skip(true, `${reason.status}: ${reason.note}`);
      return;
    }

    const seed = seedFor(state, card.fresh ?? false);
    const { context, page: p } = await openContext(browser, baseURL, id, seed, state);
    const errors: string[] = [];
    p.on("pageerror", (error) => errors.push(error.message));
    const captured: [ReportEntry["appearance"], string][] = [];
    try {
      await card.open({ page: p, seed, state });
      await p.evaluate(() => document.fonts.ready.then(() => undefined));
      for (const appearance of state.appearances) {
        await p.emulateMedia({ colorScheme: appearance });
        await expect.poll(() => p.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(appearance === "dark");
        await p.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const file = `${id}.${appearance}.png`;
        await p.screenshot({ path: `${outputDirectory}/${file}`, fullPage: false, animations: "disabled", caret: "hide" });
        captured.push([appearance, `test-results/cards/web/${file}`]);
      }
      expect(errors, "uncaught page errors").toEqual([]);
      for (const [appearance, file] of captured) record(appearance, "captured", file, card.note ?? "");
    } catch (error) {
      for (const appearance of state.appearances) record(appearance, "failed", null, error instanceof Error ? error.message.split("\n")[0] ?? "" : String(error));
      throw error;
    } finally {
      await context.close();
      if (state.fault || card.faults) await clearFaults();
    }
  });
}
