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

async function profilePane(p: Page) {
  await p.goto("/settings/profile");
  await expect(p.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Alex Martin");
}


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
  const dialog = p.getByRole("dialog", { name: "New entry" });
  await expect(dialog.getByLabel("Title")).toBeVisible();
  return dialog;
}

/** The cards' expense draft: $74.40 Dinner with friends on Visa, split 3 ways, the amount still being typed. */
async function draftDinner(dialog: ReturnType<Page["getByRole"]>) {
  await dialog.getByLabel("Title").fill("Dinner with friends");
  await dialog.getByLabel("Account").selectOption({ label: "Visa" });
  await dialog.getByLabel("Amount (CAD)").fill("74.40");
  const split = dialog.getByRole("button", { name: /^Split/ });
  await split.click();
  await dialog.getByRole("group", { name: "Split" }).getByRole("radio", { name: "Equally" }).check({ force: true });
  await dialog.getByRole("button", { name: "More people" }).click();
  await expect(split).toContainText("$24.80 yours");
  // Split closes again, as on the cards, and the amount keeps focus.
  await split.click();
  await dialog.getByLabel("Amount (CAD)").focus();
}

/** The phone's "Receipt, repeat, trip" row, open (`iphone-entry-extras`). */
async function moreDetails(p: Page) {
  const dialog = await addEntry(p);
  await dialog.getByRole("button", { name: /^Receipt, repeat, trip/ }).click();
  await expect(dialog.getByRole("group", { name: "Receipt" })).toBeVisible();
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
  // Recording a share retitles the dialog Record payment, as the card's sheet is titled.
  const dialog = run.page.getByRole("dialog", { name: /^(Internet|Record payment)$/ });
  // alex is seeded with a display name (MAZ-171), so the buttons use it.
  await dialog.getByRole("button", { name: "Mark Alex Martin's share as paid" }).click();
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
    const dialog = p.getByRole("dialog", { name: "New entry" });
    await dialog.getByLabel("Amount (CAD)").fill(amount);
    await dialog.getByLabel("Title").fill(title);
    await dialog.getByRole("button", { name: "Add expense" }).click();
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
  const detail = await entryDetail(run.page, "2026-10", /^Coffee Groceries & dining · Fri, Oct 9/, "Coffee");
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

/**
 * Adds Groceries ($48.90, the card's entry) from Home with a 503 armed on the next ledger sync,
 * then rests the pointer on its "Expense added" toast (a hovered toast stays up to 30 s), as
 * `iphone-saved-toast` draws it (MAZ-237).
 */
async function addWithFailingSync(run: Run) {
  await home(run.page);
  await run.page.getByRole("button", { name: "Add entry" }).first().click();
  const form = run.page.getByRole("dialog", { name: "New entry" });
  await form.getByLabel("Amount (CAD)").fill("48.90");
  await form.getByLabel("Title").fill("Groceries");
  await form.getByRole("radio", { name: /^Groceries/ }).check();
  await armFault(run);
  const sync = run.page.waitForResponse((response) => response.request().method() === "PUT" && new URL(response.url()).pathname === "/api/ledger");
  await form.getByRole("button", { name: "Add expense" }).click();
  expect((await sync).status(), "the armed fault answers the first sync").toBe(503);
  await expect(form).toBeHidden();
  const banner = run.page.getByRole("status").filter({ hasText: "Not synced" });
  await expect(banner).toBeVisible();
  const toast = run.page.getByText("Expense added", { exact: true });
  await toast.hover();
  await expect(run.page.getByRole("region", { name: "Recent" })).toContainText("Groceries");
  return { banner, toast };
}

async function armFault(run: Run) {
  const fault = run.state.fault;
  if (!fault) throw new Error(`${run.state.specimen} names no fault`);
  await control("PUT", "faults", { rules: [{ pathPrefix: "/", ...fault }] });
}

const NO_LOCK = "The web has no app lock by design (docs/reference/redesign.md, Access: the web uses the current origin and has no lock).";

// ---- Draft cards (MAZ-238) ----

const NATIVE_SELECT = (what: string) => `The web picks the ${what} with a native select in the entry form (a platform picker), so it has no ${what} list to compare.`;

/** Activity searching for the state's query while the server search is held back by the state's delay. */
async function searching(run: Run) {
  await armFault(run);
  await run.page.goto(`/transactions?month=2026-10&q=${encodeURIComponent(run.state.search?.query ?? "coffee")}`);
  await expect(run.page.getByRole("status").filter({ hasText: /^Searching/ })).toBeVisible();
}

/** Opens the Edit entry form of a personal entry (🎉 Party supplies), from its detail. */
async function editEntry(p: Page) {
  const detail = await partyDetail(p);
  await detail.getByRole("button", { name: "Edit" }).click();
  await expect(p.getByRole("dialog", { name: "Edit entry" })).toBeVisible();
}

/** Maison's Internet expense (Bea paid), opened from the household's expenses. */
async function sharedExpense(run: Run) {
  await maison(run, `?month=${run.state.month ?? "2026-10"}`);
  await run.page.getByRole("link", { name: /^Internet/ }).first().click();
  await expect(run.page.getByRole("button", { name: /Mark .* as paid|Edit/ }).first()).toBeVisible();
}

/** Join a household with the cards' invite code typed in. */
/** The cards' sample reset code (synthetic). */
const SAMPLE_RESET_CODE = "3f9a1c07e2b45d68a0c1f7e93b2d4a6c8e05f1b7d39a2c4e6f80b1d3a5c7e9f2";
const EMAIL_STUBBED = "The test environment has no SMTP server, so the capture stubs /api/info emailEnabled and the email endpoints (MAZ-124).";

/**
 * Email delivery for one capture (MAZ-124): the test environment sends no email, so /api/info
 * reports it on, the reset request answers its 202, and the household's invitations by email are
 * the card's sample rows. Every other request reaches the real API.
 */
async function withEmail(p: Page, invites: unknown[] = []) {
  await p.route("**/api/info", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...((await response.json()) as object), emailEnabled: true } });
  });
  await p.route("**/api/auth/password-reset/request", (route) => route.fulfill({ status: 202, json: { ok: true } }));
  await p.route(/\/api\/households\/[^/]+\/email-invites$/, (route) => route.fulfill({ json: { items: invites } }));
}

/** Reports the signed-in (seeded, verified) account as unverified, for the verification cards (MAZ-172). */
async function unverified(p: Page) {
  await p.route("**/api/profile", async (route) => {
    const response = await route.fetch();
    const profile = (await response.json()) as Record<string, unknown>;
    delete profile.emailVerifiedAt;
    await route.fulfill({ response, json: { ...profile, emailVerified: false } });
  });
  await p.route("**/api/auth/email-verification/resend", (route) => route.fulfill({ status: 202, json: { ok: true } }));
}

async function joinWithCode(p: Page) {
  await page(p, "/households", "Shared");
  await p.getByRole("list", { name: "Start sharing" }).getByRole("button", { name: /Join with a code/ }).click();
  const dialog = p.getByRole("dialog", { name: "Join a household" });
  await dialog.getByLabel("Invite code").fill("7F3A9C01B2");
}

async function personalTrip(p: Page) {
  await page(p, "/trips", "Trips");
  await p.getByRole("link", { name: /Québec weekend/ }).first().click();
  await expect(p.getByRole("heading", { level: 1, name: "Québec weekend" })).toBeVisible();
}

/** New schedule with the cards' draft: a monthly $75.00 Internet expense. */
async function newSchedule(p: Page) {
  await page(p, "/recurring", "Recurring");
  await p.getByRole("button", { name: "New schedule" }).first().click();
  const dialog = p.getByRole("dialog", { name: "New schedule" });
  // The card's draft starts on Nov 18, after the scenario clock (Oct 15), with the amount being typed.
  await dialog.getByLabel("First date").fill("2026-11-18");
  await dialog.getByLabel("Name").fill("Internet");
  await dialog.getByLabel("Amount (CAD)").fill("75.00");
}

/** Home after the server stops taking ledger syncs, with the scenario's pending create waiting. */
async function syncFailed(run: Run) {
  const p = run.page;
  await home(p);
  await armFault(run);
  await p.getByRole("button", { name: "Add entry" }).first().click();
  const dialog = p.getByRole("dialog", { name: "New entry" });
  await dialog.getByLabel("Amount (CAD)").fill("3");
  await dialog.getByLabel("Title").fill("Coffee to go");
  await dialog.getByRole("button", { name: "Add expense" }).click();
  await expect(p.getByRole("status").filter({ hasText: "1 change waiting" })).toBeVisible();
  await dismissToast(p);
}

/** Home while the household projection fails, so the shared expenses can't load. */
async function sharedMissing(run: Run) {
  await armFault(run);
  await home(run.page);
  await expect(run.page.getByRole("status").filter({ hasText: "Shared expenses may be missing" })).toBeVisible();
}

/** The demo, from sign-in's sample data link. */
async function demo(p: Page) {
  await signInScreen(p);
  await p.getByRole("button", { name: /Take a look around with sample data/ }).click();
  await expect(p.getByText("You're exploring a demo")).toBeVisible();
}

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
    note: "A keyboard form in a dialog: no keypad (MAZ-227).",
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
      await scrollTo(p, receipt);
    },
    note: "Receipt, repeat, trip expands inside the form instead of opening its own sheet (MAZ-227).",
  },
  "iphone-split": {
    open: async ({ page: p }) => {
      const dialog = await addEntry(p);
      await dialog.getByLabel("Amount (CAD)").fill("74.40");
      await dialog.getByLabel("Title").fill("Dinner with friends");
      await dialog.getByRole("button", { name: /^Split/ }).click();
      const split = dialog.getByRole("group", { name: "Split" });
      // By keyboard: on a phone the dialog's sticky footer covers the group until it scrolls.
      await split.getByRole("radio", { name: "All mine" }).focus();
      await p.keyboard.press("ArrowRight");
      await expect(split.getByRole("radio", { name: "Equally" })).toBeChecked();
      // The card splits equally between 3 people (as the iOS capture does).
      await dialog.getByRole("button", { name: "More people" }).click();
      await expect(dialog.getByRole("status").filter({ hasText: "Your share" })).toContainText("$24.80");
      await scrollTo(p, split);
    },
    note: "The draft amount and title are typed to match the card ($74.40, Dinner with friends); Split expands inside the form instead of a stacked sheet (MAZ-227).",
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
  "iphone-shared-people": {
    open: async (run) => {
      // The card shows a live invite code.
      await maison(run, "?tab=people");
      await run.page.getByRole("button", { name: "Create invite code" }).click();
      await expect(run.page.getByText(/^Expires in/)).toBeVisible();
    },
    note: "The invite code is created for the capture; the web shows Copy and no share sheet (MAZ-229).",
  },
  "iphone-shared-expense-add": {
    open: async (run) => {
      await maison(run);
      await run.page.getByRole("button", { name: "Shared expense" }).click();
      const dialog = run.page.getByRole("dialog", { name: "New expense" });
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
      await p.getByRole("list", { name: "Start sharing" }).getByRole("button", { name: /New household/ }).click();
      const dialog = p.getByRole("dialog", { name: "New household" });
      await dialog.getByLabel("Name").fill("Apartment");
      await dialog.getByLabel("Name").blur();
    },
  },
  "iphone-history": {
    open: async (run) => {
      await page(run.page, `/households/${household(run, "maison")}?tab=history`, "History");
      await expect(run.page.getByRole("region", { name: "History" })).toBeVisible();
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
    note: "Settings is a page styled as the sheet (no tab bar, Done closes it), without Home behind it.",
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
      // The card edits Visa, which entries and schedules use, so it offers Move and remove.
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
      // The card's draft: an email and a 13-character password, three of four strength steps.
      await p.getByLabel("Name").fill("Max Falicoff");
      await p.getByLabel("Email").fill("max@example.com");
      await p.getByLabel("Password", { exact: true }).fill("penny-sample1");
      await p.getByLabel("Password", { exact: true }).blur();
    },
  },
  "iphone-server-connect": {
    skip: { status: "not-applicable", note: "The web always uses the server it was opened from; it has no signed-out server entry (Settings › Server & sync shows it read-only when signed in)." },
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
      const dialog = (await p.getByRole("button", { name: "Add entry" }).first().click(), p.getByRole("dialog", { name: "New entry" }));
      await dialog.getByLabel("Amount (CAD)").fill("3");
      await dialog.getByLabel("Title").fill("Coffee to go");
      await dialog.getByRole("button", { name: "Add expense" }).click();
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
      const { banner, toast } = await addWithFailingSync(run);
      const retried = run.page.waitForResponse((response) => response.request().method() === "PUT" && new URL(response.url()).pathname === "/api/ledger");
      await banner.getByRole("button", { name: "Retry" }).press("Enter");
      expect((await retried).status(), "the retry syncs").toBe(200);
      await expect(banner).toBeHidden();
      await expect(toast).toBeVisible();
    },
    note: "The toast is the new Groceries expense's 'Expense added' with its category tile and Undo, still shown on Home after Retry in the sync banner synced it.",
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
  "iphone-sign-out-plain": {
    open: async ({ page: p }) => {
      await page(p, "/settings", "Settings");
      await p.getByRole("button", { name: "Sign out" }).click();
      const dialog = p.getByRole("dialog", { name: "Sign out of Penny?" });
      await expect(dialog.getByRole("button", { name: "Sign out" })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Sync, then sign out" })).toHaveCount(0);
    },
  },

  // Draft cards (MAZ-238): screens that had no card. Each opens the app's screen as it is today.
  "iphone-activity-filters": {
    open: async ({ page: p }) => {
      await activity(p, "2026-10");
      await p.getByRole("button", { name: /^Filters/ }).first().click();
      await expect(p.getByRole("dialog", { name: /Filters/ })).toBeVisible();
    },
  },
  "iphone-activity-searching": { faults: true, open: (run) => searching(run) },
  "iphone-home-explore": {
    open: async ({ page: p }) => {
      await home(p);
      // The web's Home has no Expected income card or Explore your month: the capture shows the end of Home.
      await scrollTo(p, p.getByRole("region", { name: "Recent" }));
    },
  },
  // alex's October has no income yet, so Left to spend is negative (MAZ-254).
  "iphone-home-overspent": {
    open: async ({ page: p }) => {
      await home(p);
      await expectAlexOctober(p);
    },
  },
  "iphone-account-picker": { skip: { status: "not-built", note: NATIVE_SELECT("account") } },
  "iphone-household-picker": { skip: { status: "not-built", note: NATIVE_SELECT("household") } },
  "iphone-edit-entry": { open: ({ page: p }) => editEntry(p) },
  "iphone-shared-expense-detail": { open: (run) => sharedExpense(run) },
  "iphone-join-code": { open: ({ page: p }) => joinWithCode(p) },
  "iphone-invite-scanner": { skip: { status: "not-applicable", note: "The web has no camera scanner: invite codes are typed; the card has no web owner." } },
  "iphone-invite": {
    open: async (run) => {
      await maison(run, "?tab=people");
      await run.page.getByRole("button", { name: "Create invite code" }).click();
      await expect(run.page.getByText(/^Expires in/)).toBeVisible();
    },
    note: "The web has no Invite sheet: the code is created under People, as on iphone-shared-people.",
  },
  "iphone-notifications-prompt": { skip: { status: "not-applicable", note: "The web has no notifications; the card has no web owner." } },
  "iphone-trip-personal": { open: ({ page: p }) => personalTrip(p) },
  "iphone-trip-share": {
    open: async ({ page: p }) => {
      await personalTrip(p);
      await p.getByRole("button", { name: "Share trip" }).first().click();
      await expect(p.getByRole("dialog")).toBeVisible();
    },
  },
  "iphone-schedule-form": { open: ({ page: p }) => newSchedule(p) },
  "iphone-currency": { open: ({ page: p }) => page(p, "/settings/currency", "Currency") },
  "iphone-sync-failed": { fresh: true, faults: true, open: (run) => syncFailed(run) },
  "iphone-shared-missing": { faults: true, open: (run) => sharedMissing(run) },
  "iphone-demo": { open: ({ page: p }) => demo(p) },

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
  "ipad-add-entry": {
    open: async ({ page: p }) => {
      await draftDinner(await addEntry(p));
    },
  },
  "ipad-shared": { open: (run) => maison(run) },
  "ipad-trip": { open: (run) => lisbon(run) },
  "ipad-settings": { open: ({ page: p }) => page(p, "/settings", "Settings") },
  "ipad-home-portrait": {
    open: async ({ page: p }) => {
      await home(p);
      await expectAlexOctober(p);
    },
  },

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
    // The card's past shared trip (Cottage weekend, Settled): created here through the API so the
    // seed every platform shares doesn't change. Alex paid and is its only member, so nobody owes.
    fresh: true,
    open: async ({ page: p }) => {
      await p.goto("/");
      const created = await p.request.post("/api/households/trips", { data: { name: "Cottage weekend", currency: "CAD", startDate: "2026-08-22", endDate: "2026-08-24" } });
      expect(created.status(), "the past shared trip").toBe(201);
      const { household } = (await created.json()) as { household: { id: string; creatorId: string } };
      const expense = await p.request.post(`/api/households/${household.id}/expenses`, {
        data: { title: "Cottage rental", totalCents: 23875, payerUserId: household.creatorId, splitMode: "equal", date: "2026-08-22", category: { name: "Home", icon: "home", color: "#C27C4E" } },
      });
      expect(expense.status(), "the past trip's expense").toBe(201);
      await page(p, "/trips", "Trips");
      await expect(p.getByRole("heading", { name: "Lisbon trip" })).toBeVisible();
      await expect(p.getByRole("link", { name: /Cottage weekend/ })).toContainText("Settled");
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

  // Draft cards (MAZ-238)
  "web-households": {
    open: async ({ page: p }) => {
      await page(p, "/households", "Shared");
      await expect(p.getByRole("link", { name: /^Maison/ }).first()).toBeVisible();
    },
  },
  "web-shared-expense": { open: (run) => sharedExpense(run) },
  "web-trip": { open: (run) => lisbon(run) },
  "web-recurring": {
    open: async ({ page: p }) => {
      await page(p, "/recurring", "Recurring");
      await expect(p.getByRole("button", { name: /^Gym/ })).toBeVisible();
    },
  },
  "web-accounts": {
    open: async ({ page: p }) => {
      await page(p, "/accounts", "Accounts");
      await expect(p.getByRole("button", { name: "Edit Everyday chequing" })).toBeVisible();
    },
  },
  "web-categories": {
    open: async ({ page: p }) => {
      await page(p, "/categories", "Categories");
      await expect(p.getByRole("button", { name: "Edit Groceries & dining" })).toBeVisible();
    },
  },
  "web-currency": { open: ({ page: p }) => page(p, "/settings/currency", /Currency|Settings/) },
  "web-schedule-form": { open: ({ page: p }) => newSchedule(p) },
  "web-edit-entry": { open: ({ page: p }) => editEntry(p) },
  "web-join-code": { open: ({ page: p }) => joinWithCode(p) },
  "web-activity-searching": { faults: true, open: (run) => searching(run) },
  "web-server-unreachable": {
    faults: true,
    open: async (run) => {
      // The shell shows the banner when the server's info request fails while the browser is online.
      await armFault(run);
      await run.page.goto("/");
      await expect(run.page.getByRole("heading", { level: 1, name: "Home", exact: true })).toBeVisible();
      await expect(run.page.getByText("Can't reach your Penny server")).toBeVisible({ timeout: 30_000 });
    },
  },
  "web-demo": { open: ({ page: p }) => demo(p) },
  "web-tablet": {
    open: async ({ page: p }) => {
      await home(p);
      await expectAlexOctober(p);
    },
  },
  "web-password-reset": {
    open: async ({ page: p }) => {
      await p.goto("/reset-password");
      await expect(p.getByRole("heading", { level: 1, name: "Set a new password" })).toBeVisible();
      await p.getByLabel("Reset code").fill(SAMPLE_RESET_CODE);
      await p.getByLabel("New password").fill("password");
    },
  },
  "web-export": { skip: { status: "not-built", note: "The web has no Export data yet (Settings has no Export row)." } },

  // Emailed receipts (MAZ-184): blocked by their state until the full-stack seed has a receipt
  // address and inbox items; they need an `open` here once it does.
  "web-receipt-inbox": {},
  "web-receipt-inbox-item": {},
  "web-receipt-attach-file": {},
  "web-receipt-attach-entry": {},
  "web-receipt-attach-confirm": {},
  "web-receipt-attached-toast": {},
  "web-receipt-email-settings": {},

  // Account and profile cards drafted for review (MAZ-267): none of these flows exist on the web yet.
  "iphone-profile": {
    open: ({ page: p }) => profilePane(p),
    note: "Profile is a page styled as the sheet. Your data (export, delete account) is missing: those features aren't built yet.",
  },
  "iphone-profile-provider": { skip: { status: "blocked", note: "The full-stack seeds have no account that signs in with a provider; the read-only profile is covered by the web unit tests." } },
  "iphone-profile-photo": {
    fresh: true,
    open: async ({ page: p }) => {
      await profilePane(p);
      const chooser = p.waitForEvent("filechooser");
      await p.getByRole("button", { name: "Add picture" }).last().click();
      await (await chooser).setFiles({ name: "portrait.png", mimeType: "image/png", buffer: syntheticPng(900, 1200) });
      await expect(p.getByRole("dialog", { name: "Move and scale" })).toBeVisible();
      await expect(p.getByRole("button", { name: "Choose" })).toBeEnabled();
    },
    note: "With a mouse the subtitle reads \"Scroll to zoom, drag to move\"; touch screens get the card's words.",
  },
  "iphone-name-prompt": {
    fresh: true,
    open: async ({ page: p }) => {
      // The card's account has no name yet: clear alex's seeded one, then open Home.
      await p.goto("/settings/profile");
      await expect(p.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Alex Martin");
      expect(await p.evaluate(async () => (await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: null }) })).status)).toBe(200);
      await home(p);
      const prompt = p.getByRole("dialog", { name: "What should people call you?" });
      await prompt.getByLabel("Name").fill("Max");
    },
  },
  "iphone-sign-in-providers": { skip: { status: "not-built", note: "The web has no Apple or Google sign-in, Forgot password or privacy policy link." } },
  "iphone-create-account-providers": { skip: { status: "not-built", note: "The web has no Apple or Google sign-up or privacy policy line (it has the Name field)." } },
  "iphone-verify-email": { skip: { status: "not-built", note: "The native app's screen. On a phone the web shows web-verify-email's page." } },
  "iphone-unverified": { skip: { status: "not-built", note: "The native app's Shared tab reminder (MAZ-172 phase 2). The web shows the unverified state and Resend link in Settings › Profile." } },
  "iphone-forgot-password": { skip: { status: "not-built", note: "The web has no password reset by email (the server sends no email)." } },
  "iphone-invite-email": { skip: { status: "not-built", note: "The web has no invites by email (the server sends no email)." } },
  "iphone-delete-account": { skip: { status: "not-built", note: "The web has no account deletion." } },
  "iphone-export-all": { skip: { status: "not-built", note: "The web has no full data export." } },
  "iphone-monitoring-prompt": { skip: { status: "not-built", note: "The web sends errors and timings when its server turns telemetry on, but asks nobody: there is no consent prompt." } },
  "iphone-privacy": { skip: { status: "not-built", note: "The web has no Privacy page: telemetry is on or off for the whole server, with no switches for the person." } },
  "ipad-profile": {
    open: ({ page: p }) => profilePane(p),
    note: "Your data (export, delete account) is missing: those features aren't built yet.",
  },
  "web-profile": {
    open: ({ page: p }) => profilePane(p),
    note: "Your data (export, delete account) is missing, and the section list has no Privacy or Export data: those features aren't built yet.",
  },
  "web-sign-in-providers": { skip: { status: "not-built", note: "The web has no Apple or Google sign-in, Forgot password or privacy policy link." } },
  "web-create-account": { skip: { status: "not-built", note: "The web has no Apple or Google sign-up or privacy policy line (it has the Name field)." } },
  "web-verify-email": {
    note: `${EMAIL_STUBBED} The capture also reports the seeded account as unverified, since every seeded account is verified.`,
    open: async ({ page: p }) => {
      await withEmail(p);
      await unverified(p);
      await p.clock.install({ time: Date.parse(AT) });
      await p.goto("/verify-email");
      await expect(p.getByRole("heading", { level: 1, name: "Check your email" })).toBeVisible();
      // Time stands still at 0:42 for the capture, while frames and timers keep running.
      await p.clock.pauseAt(Date.parse(AT) + 19_000);
      await p.clock.resume();
      await p.clock.setFixedTime(Date.parse(AT) + 19_000);
      await expect(p.getByText(/Resend in/)).toContainText("0:42");
    },
  },
  "web-email-verified": {
    note: `${EMAIL_STUBBED} The emailed link's code is answered by a stub, since the capture has no email to read it from.`,
    open: async ({ page: p }) => {
      await withEmail(p);
      await p.route("**/api/auth/email-verification", async (route) => {
        const me = await (await p.request.get("/api/auth/me")).json() as { email: string };
        await route.fulfill({ json: { email: me.email } });
      });
      await p.goto(`/verify-email#code=${SAMPLE_RESET_CODE}`);
      await expect(p.getByRole("heading", { level: 1, name: "Your email is verified" })).toBeVisible();
    },
  },
  "web-forgot-password": {
    note: EMAIL_STUBBED,
    open: async ({ page: p }) => {
      await withEmail(p);
      await p.clock.install({ time: Date.parse(AT) });
      await p.goto("/forgot-password");
      await p.clock.pauseAt(Date.parse(AT) + 5_000);
      await p.getByLabel("Email").fill("alex@example.test");
      await p.getByRole("button", { name: "Send reset link" }).click();
      await expect(p.getByText("Check your email")).toBeVisible();
      await p.clock.runFor(18_000);
      // Time stands still at 0:42 for the capture, while frames and timers keep running.
      await p.clock.resume();
      await p.clock.setFixedTime(Date.parse(AT) + 23_000);
      await expect(p.getByRole("button", { name: /^Resend in/ })).toContainText("0:42");
    },
  },
  "web-forgot-password-request": {
    note: EMAIL_STUBBED,
    open: async ({ page: p }) => {
      await withEmail(p);
      await p.goto("/forgot-password");
      await expect(p.getByRole("heading", { level: 1, name: "Reset your password" })).toBeVisible();
      await p.getByLabel("Email").fill("alex@example.test");
    },
  },
  "web-password-reset-link": {
    note: EMAIL_STUBBED,
    open: async ({ page: p }) => {
      await withEmail(p);
      await p.goto(`/reset-password#code=${SAMPLE_RESET_CODE}`);
      await expect(p.getByRole("heading", { level: 1, name: "Set a new password" })).toBeVisible();
      await p.getByLabel("New password").fill("password");
    },
  },
  "web-invite-email": {
    note: EMAIL_STUBBED,
    open: async (run) => {
      await withEmail(run.page, [
        { id: "ei-1", email: "jo.s@example.com", status: "waiting", createdAt: Date.parse(AT) - 3_600_000, sentAt: Date.parse(AT) - 3_600_000, expiresAt: Date.parse(AT) + 68 * 3_600_000 },
        { id: "ei-2", email: "alex.k@example.com", status: "expired", createdAt: Date.parse(AT) - 5 * 86_400_000, sentAt: Date.parse(AT) - 5 * 86_400_000, expiresAt: Date.parse(AT) - 2 * 86_400_000 },
      ]);
      await maison(run);
      await run.page.getByRole("button", { name: "Invite", exact: true }).click();
      const dialog = run.page.getByRole("dialog", { name: "Invite to Maison" });
      await expect(dialog.getByText("jo.s@example.com")).toBeVisible();
      await dialog.getByLabel("Email").fill("sam@example.com");
    },
  },
  "web-delete-account": { skip: { status: "not-built", note: "The web has no account deletion." } },
  "web-export-all": { skip: { status: "not-built", note: "The web has no Export data pane." } },
  "web-privacy": { skip: { status: "not-built", note: "The web has no Privacy pane: telemetry is on or off for the whole server, with no switches for the person." } },
  "web-monitoring-prompt": { skip: { status: "not-built", note: "The web sends errors and timings when its server turns telemetry on, but asks nobody: there is no consent prompt." } },
};

/**
 * Closes the toast. The saved toast has Undo as its only button (MAZ-233), so it is waited out
 * with the pointer moved off it (a hovered toast stays up to 30 s).
 */
async function dismissToast(p: Page) {
  const close = p.getByRole("button", { name: "Dismiss" });
  if (await close.count()) {
    await close.first().click();
    return;
  }
  await p.mouse.move(0, 0);
  await expect(p.locator(".pk-toast")).toHaveCount(0, { timeout: 15_000 });
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
