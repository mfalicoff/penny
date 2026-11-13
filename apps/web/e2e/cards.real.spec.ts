import { expect, test, type Browser, type Page } from "@playwright/test";
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
// Viewports: web 1440×900, iPad 1194×834, iPhone 402×874 (the app picks its phone layout by
// width, so no touch emulation). The browser runs in UTC with its clock pinned to the scenario's.
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
  /** How the web state differs from the card's, for the report. */
  note?: string;
}

// ---- Navigation through the app's own UI ----

async function home(page: Page, path = "/") {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Left to spend" })).toBeVisible();
}

/** The recorded and projected totals of `alex-2026-10` on Home. */
async function expectAlexOctober(page: Page) {
  const totals = page.getByRole("region", { name: "Left to spend" });
  await expect(totals).toContainText("Recorded remaining: -$1,759.50");
  await expect(totals).toContainText("Projected remaining: -$1,807.50");
  await expect(totals).toContainText("$1,259.50");
  await expect(totals).toContainText("$500.00");
}

async function page(pageRef: Page, path: string, heading: string | RegExp) {
  await pageRef.goto(path);
  await expect(pageRef.getByRole("heading", { level: 1, name: heading })).toBeVisible();
}

async function activity(p: Page, month: string) {
  await page(p, `/transactions?month=${month}`, "Activity");
  await expect(p.getByRole("region", { name: "Search results" }).getByRole("status")).toHaveText(/transaction/);
}

async function addEntry(p: Page) {
  await home(p);
  await p.getByRole("button", { name: "Add entry" }).first().click();
  const dialog = p.getByRole("dialog", { name: "Add entry" });
  await expect(dialog.getByLabel("Title")).toBeVisible();
  return dialog;
}

async function moreDetails(p: Page) {
  const dialog = await addEntry(p);
  await dialog.getByRole("button", { name: /^More details/ }).click();
  await expect(dialog.getByRole("group", { name: "Your share" })).toBeVisible();
  return dialog;
}

/** Opens a personal entry's detail from Activity. */
async function entryDetail(p: Page, month: string, row: RegExp, title: string) {
  await activity(p, month);
  await p.getByRole("button", { name: row }).click();
  const dialog = p.getByRole("dialog", { name: title });
  await expect(dialog.getByRole("button", { name: "Edit" })).toBeVisible();
  return dialog;
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
 * ledger sync, then returns to Home (the cards' page) by keyboard, so the pointer keeps holding the
 * "Changes saved" toast (a hovered toast stays up to 30 s).
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
  await run.page.getByRole("navigation", { name: "Tabs" }).getByRole("link", { name: "Home", exact: true }).press("Enter");
  await expect(run.page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
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
      await page(p, "/insights?month=2026-09", "Insights");
      await scrollTo(p, p.getByRole("region", { name: "Follow your money" }));
    },
    note: "The money flow is part of Insights (scrolled to it); on phones it is the stacked bar flow, not a Sankey.",
  },
  "iphone-insights": {
    open: async ({ page: p }) => {
      await page(p, "/insights?month=2026-10", "Insights");
      await expect(p.getByRole("heading", { name: "Follow your money" })).toBeVisible();
    },
  },
  "iphone-calendar": {
    open: async ({ page: p }) => {
      await home(p);
      await scrollTo(p, p.getByRole("region", { name: "Calendar" }));
    },
    note: "The calendar is a section of Home's Explore your month (scrolled to it), not a sheet.",
  },
  "iphone-activity": { open: ({ page: p }) => activity(p, "2026-10") },
  "iphone-search-empty": {
    open: async ({ page: p, state }) => {
      await page(p, `/transactions?q=${encodeURIComponent(state.search?.query ?? "zzzz")}`, "Activity");
      const results = p.getByRole("region", { name: "Search results" });
      await expect(results.getByRole("status")).toHaveText(/No matching/);
      await scrollTo(p, results);
    },
  },

  // Add entry
  "iphone-add-expense": {
    open: async ({ page: p }) => {
      await addEntry(p);
    },
    note: "A keyboard form in a dialog: no large amount or keypad.",
  },
  "iphone-add-income": {
    open: async ({ page: p }) => {
      const dialog = await addEntry(p);
      await dialog.getByRole("radio", { name: "Income" }).check({ force: true });
      await expect(dialog.getByRole("radio", { name: "Income" })).toBeChecked();
    },
  },
  "iphone-entry-extras": {
    open: async ({ page: p }) => {
      const dialog = await moreDetails(p);
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
      for (let step = 0; step < 3; step++) await p.keyboard.press("ArrowRight");
      await expect(share.getByRole("radio", { name: "Percent" })).toBeChecked();
      await scrollTo(p, share);
      await dialog.getByRole("textbox", { name: "Your percentage" }).fill("50");
      await expect(dialog.getByRole("status").filter({ hasText: "Your share" })).toContainText("$37.20");
      await scrollTo(p, share);
    },
    note: "The draft amount and title are typed to match the card ($74.40, Dinner with friends); the share is a percentage in the form, not a separate page.",
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
    open: async ({ page: p }) => {
      const detail = await entryDetail(p, "2026-10", /^Coffee Personal · Groceries & dining · Fri, Oct 9/, "Coffee");
      await detail.getByRole("button", { name: "Delete" }).click();
      await expect(p.getByRole("dialog", { name: "Delete Coffee?" })).toBeVisible();
    },
    note: "p-coffee-2 is a personal entry, so there is no shared 'delete for everyone' wording.",
  },

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
      await expect(run.page.getByRole("dialog", { name: "New shared expense" })).toBeVisible();
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
      await expect(p.getByRole("dialog", { name: "New household" })).toBeVisible();
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
      await expect(p.getByRole("dialog", { name: "New trip" })).toBeVisible();
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
      await p.getByRole("button", { name: "Add account" }).click();
      await expect(p.getByRole("dialog", { name: /account/i })).toBeVisible();
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
      await expect(p.getByRole("dialog", { name: /category/i })).toBeVisible();
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
      await expect(p.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
      await expect(p.getByRole("link", { name: "Add your first entry" })).toBeVisible();
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
    },
    note: "The web learns the server is unreachable when its sync fails: Coffee to go (the scenario's pending create) waits to sync. The banner names a busy server, not Offline, because the browser itself is online.",
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
    note: "The toast is the edit's 'Changes saved' (no Undo), still shown on Home after Retry in the sync banner synced it.",
  },
  "iphone-sign-out": {
    open: async ({ page: p }) => {
      await page(p, "/settings", "Settings");
      await p.getByRole("button", { name: "Sign out" }).click();
      await expect(p.getByRole("dialog", { name: "Sign out of Penny?" })).toBeVisible();
    },
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
    note: "The entry detail is a dialog over Activity, not a detail pane beside it.",
  },
  "ipad-add-entry": { open: ({ page: p }) => addEntry(p) },
  "ipad-shared": { open: (run) => maison(run) },
  "ipad-trip": { open: (run) => lisbon(run) },
  "ipad-settings": { open: ({ page: p }) => page(p, "/settings", "Settings") },

  // Web
  "web-home": {
    open: async ({ page: p }) => {
      await home(p);
      await expectAlexOctober(p);
    },
  },
  "web-activity": {
    open: ({ page: p }) => partyDetail(p),
    note: "Activity is a list, and the entry detail a dialog, not a table with a side panel.",
  },
  "web-insights": { open: ({ page: p }) => page(p, "/insights?month=2026-09", "Insights") },
  "web-household": { open: (run) => maison(run, `?month=${run.state.month ?? "2026-10"}`) },
  "web-trips": {
    open: async ({ page: p }) => {
      await page(p, "/trips", "Trips");
      await expect(p.getByRole("heading", { name: "Lisbon trip" })).toBeVisible();
    },
  },
  "web-settings": { open: ({ page: p }) => page(p, "/settings", "Settings") },
  "web-add-entry": { open: ({ page: p }) => addEntry(p) },
  "web-sign-in": { open: ({ page: p }) => signInScreen(p) },
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
      if (state.fault) await clearFaults();
    }
  });
}
