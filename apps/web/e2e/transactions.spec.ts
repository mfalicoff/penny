import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./test";
import { openExtras, SAVE } from "./entry";

// Transaction forms, search and filtered Activity (MAZ-88) in real Chromium on desktop and phone:
// the durable offline store (IndexedDB), the browser's offline switch, history and keyboard use.
// /api is mocked: a revision-checked ledger, MAZ-121 search over it, and the shared projection.
// The real .NET/PostgreSQL journeys are MAZ-95. Synthetic data only.

const EMAIL = "alex@example.test";
const NOV_10 = Date.parse("2026-11-10T15:00:00Z");

interface Entry {
  id: string;
  title: string;
  kind: "expense" | "income" | "investment";
  total: number;
  share: number;
  categoryId: string;
  date: string;
  note: string;
  accountId?: string;
}

const entry = (id: string, title: string, extra: Partial<Entry> = {}): Entry => ({ id, title, kind: "expense", total: 1200, share: 1200, categoryId: "groceries", date: "2026-11-02", note: "", ...extra });

const hydro = {
  id: "e1",
  householdId: "h1",
  householdName: "Maison",
  householdCurrency: "CAD",
  title: "Hydro",
  date: "2026-11-03",
  totalCents: 9000,
  shareCents: 3000,
  payerUserId: "u2",
  payer: { email: "bea@example.test" },
  paidByYou: false,
  category: { name: "Groceries", icon: "basket-outline", color: "#6C9C79" },
  note: "",
};

interface Server {
  revision: number;
  ledger: {
    version: 4;
    currency: string;
    accounts: { id: string; name: string; type: string }[];
    trips: unknown[];
    categories: { id: string; name: string; icon: string; color: string; kind: string }[];
    transactions: Entry[];
    recurring: unknown[];
  };
  down: boolean;
  puts: number;
}

async function mockApi(context: BrowserContext): Promise<Server> {
  const server: Server = {
    revision: 3,
    ledger: {
      version: 4,
      currency: "CAD",
      accounts: [{ id: "chq", name: "Chequing", type: "bank" }],
      trips: [],
      categories: [
        { id: "groceries", name: "Groceries", icon: "basket-outline", color: "#6C9C79", kind: "expense" },
        { id: "food", name: "Food & drinks", icon: "cafe-outline", color: "#E47850", kind: "expense" },
        { id: "salary", name: "Salary", icon: "briefcase-outline", color: "#6C9C79", kind: "income" },
      ],
      transactions: [entry("rent", "Rent", { total: 145000, share: 145000, date: "2026-11-01", categoryId: "food" }), entry("pay", "Monthly salary", { kind: "income", categoryId: "salary", total: 480000, share: 480000, date: "2026-11-05" })],
      recurring: [],
    },
    down: false,
    puts: 0,
  };
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/info") return route.fulfill({ json: { name: "penny", version: "2.0.0-e2e" } });
    if (url.pathname === "/api/auth/me") return route.fulfill({ json: { email: EMAIL } });
    if (url.pathname === "/api/auth/oidc") return route.fulfill({ json: { enabled: false, providers: [] } });
    if (url.pathname === "/api/receipt-email") return route.fulfill({ json: { enabled: false, domain: null, address: null } });
    if (server.down) return route.abort("connectionrefused");
    if (url.pathname === "/api/ledger") {
      if (request.method() === "PUT") {
        const body = request.postDataJSON() as { revision: number; ledger: Server["ledger"] };
        if (body.revision !== server.revision) return route.fulfill({ status: 409, json: { error: "The ledger changed." } });
        server.revision += 1;
        server.puts += 1;
        server.ledger = body.ledger;
      }
      return route.fulfill({ json: { revision: server.revision, ledger: server.ledger } });
    }
    if (url.pathname === "/api/households/projection") {
      const month = url.searchParams.get("month");
      return route.fulfill({ json: { transactions: !month || hydro.date.startsWith(month) ? [hydro] : [], scheduled: [] } });
    }
    if (url.pathname === "/api/v1/search/transactions") {
      // A small stand-in for MAZ-121: substring over title, date range and kind, newest first.
      const body = request.postDataJSON() as { query?: string; from?: string; to?: string; kind?: string };
      const query = body.query?.toLowerCase() ?? "";
      const inRange = (date: string) => (!body.from || date >= body.from) && (!body.to || date <= body.to);
      const personal = server.ledger.transactions
        .filter((item) => inRange(item.date) && (!body.kind || item.kind === body.kind) && item.title.toLowerCase().includes(query))
        .map((item) => ({ key: `personal:${item.id}`, source: "personal", match: query ? "title" : null, entry: item }));
      const shared = inRange(hydro.date) && (!body.kind || body.kind === "expense") && hydro.title.toLowerCase().includes(query) ? [{ key: "shared:e1", source: "shared", match: null, entry: hydro }] : [];
      const items = [...personal, ...shared].sort((a, b) => b.entry.date.localeCompare(a.entry.date) || a.key.localeCompare(b.key));
      return route.fulfill({ json: { version: 1, items, totalCount: items.length, nextCursor: null } });
    }
    return route.fulfill({ status: 404, json: { error: "API route not found." } });
  });
  return server;
}

async function open(page: Page, path: string) {
  await page.clock.setFixedTime(NOV_10);
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

const results = (page: Page) => page.getByRole("region", { name: "Search results" });
const form = (page: Page, name = "New entry") => page.getByRole("form", { name });

/** A personal entry's detail: a dialog on phones, the panel beside the list from 1100px (`web-activity`, MAZ-225). */
const detailOf = (page: Page, title: string) => page.getByRole("dialog", { name: title }).or(page.getByRole("complementary", { name: title }));

/** One row of the list (phones) or the table (desktops). */
const rowOf = (page: Page, text: string) => results(page).getByRole("listitem").or(results(page).getByRole("row")).filter({ hasText: text });

/**
 * Waits for this browser's ledger (the period's figures come from it): the desktop summary line
 * (`web-activity`), or on a phone, which has no summary (`iphone-activity`), the categories in Filters.
 */
async function ledgerReady(page: Page, isMobile: boolean) {
  if (!isMobile) {
    await expect(page.locator(".activity-summary")).toContainText("entries");
    return;
  }
  await page.getByRole("button", { name: /^Period: / }).click();
  const filters = page.getByRole("dialog", { name: "Filters" });
  await expect(filters.getByRole("group", { name: "Category" })).toBeVisible();
  await filters.getByRole("button", { name: "Done" }).click();
}

/** The previous or next period: beside the title on a desktop, in Filters on a phone. */
async function stepPeriod(page: Page, isMobile: boolean, name: "Previous month" | "Next month") {
  if (!isMobile) {
    await page.getByRole("button", { name }).click();
    return;
  }
  await page.getByRole("button", { name: /^Period: / }).click();
  const filters = page.getByRole("dialog", { name: "Filters" });
  await filters.getByRole("button", { name }).click();
  await filters.getByRole("button", { name: "Done" }).click();
}

test("adds an expense with the keyboard only and finds it in Activity", async ({ context, page, isMobile }) => {
  const server = await mockApi(context);
  await open(page, "/transactions?month=2026-11");
  await expect(results(page).getByRole("link", { name: /Hydro/ })).toBeVisible();
  await ledgerReady(page, isMobile);

  await page.keyboard.press("n");
  const add = form(page);
  await expect(add.getByLabel("Amount (CAD)")).toBeFocused();
  await page.keyboard.type("18.40");
  await page.keyboard.press("Tab");
  await expect(add.getByLabel("Title")).toBeFocused();
  await page.keyboard.type("Coffee beans");
  await page.keyboard.press("Tab");
  // The most used category comes first and is chosen; the chips are one radio group, so arrow keys move the choice.
  await expect(add.getByRole("radio", { name: "Food & drinks" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(add.getByRole("radio", { name: "Groceries" })).toBeChecked();
  await add.getByLabel("Date").fill("2026-11-06");
  await page.keyboard.press("ControlOrMeta+Enter");

  await expect(page.getByText("Expense added")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(results(page).getByRole("button", { name: /^Coffee beans/ })).toBeVisible();
  await expect.poll(() => server.ledger.transactions.map((item) => item.title)).toContain("Coffee beans");
  expect(server.ledger.transactions.find((item) => item.title === "Coffee beans")).toMatchObject({ total: 1840, share: 1840, categoryId: "groceries", date: "2026-11-06" });
  // The desktop summary counts it (phones have none, as on iphone-activity).
  if (!isMobile) await expect(page.locator(".activity-summary")).toContainText("spent $1,498.40");
});

test("keeps the draft through a closed dialog and an inline category, and validates before saving", async ({ context, page }) => {
  const server = await mockApi(context);
  await open(page, "/");
  await page.getByRole("button", { name: "Add entry" }).click();
  let add = form(page);
  await add.getByLabel("Amount (CAD)").fill("62");
  await page.getByRole("dialog", { name: "New entry" }).getByRole("button", { name: SAVE }).click();
  await expect(add.getByLabel("Title")).toBeFocused();
  await expect(add.getByText("Add a name for this entry.")).toBeVisible();
  await add.getByLabel("Title").fill("Vet visit");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Add entry" }).click();
  add = form(page);
  await expect(add.getByText("Your unsaved draft is back.")).toBeVisible();
  await expect(add.getByLabel("Title")).toHaveValue("Vet visit");
  await add.getByRole("button", { name: "All categories" }).click();
  const picker = page.getByRole("dialog", { name: "Expense category" });
  await picker.getByRole("button", { name: "New category" }).click();
  await picker.getByLabel("New category name").fill("Pets");
  await picker.getByRole("button", { name: "Add category" }).click();
  await expect(picker).toHaveCount(0);
  await expect(add.getByRole("radio", { name: "Pets" })).toBeChecked();
  await expect(add.getByLabel("Amount (CAD)")).toHaveValue("62");
  await page.getByRole("dialog", { name: "New entry" }).getByRole("button", { name: SAVE }).click();
  await expect(page.getByText("Expense added")).toBeVisible();
  await expect.poll(() => server.ledger.categories.map((category) => category.name)).toContain("Pets");
  await expect.poll(() => server.ledger.transactions.find((item) => item.title === "Vet visit")?.total).toBe(6200);
});

test("saves offline, keeps the entry through a reload, and syncs it once back online", async ({ context, page, isMobile }) => {
  const server = await mockApi(context);
  await open(page, "/transactions?month=2026-11");
  await expect(results(page).getByRole("button", { name: /^Rent/ })).toBeVisible();
  // The ledger has downloaded once, so it can be added to offline.
  await ledgerReady(page, isMobile);

  server.down = true;
  await context.setOffline(true);
  await page.getByRole("button", { name: "Add entry" }).click();
  const add = form(page);
  await add.getByLabel("Amount (CAD)").fill("7.50");
  await add.getByLabel("Title").fill("Bakery");
  await add.getByLabel("Date").fill("2026-11-08");
  await page.getByRole("dialog", { name: "New entry" }).getByRole("button", { name: SAVE }).click();
  await expect(page.getByText("Saved on this device. It syncs when you're back online.")).toBeVisible();
  await expect(rowOf(page, "Bakery")).toContainText("Waiting to sync");
  // Shared rows stay visible from what Penny last loaded.
  await expect(results(page).getByRole("link", { name: /Hydro/ })).toBeVisible();
  await expect(results(page)).toContainText("on this device");

  // Reload with the network back but the server still unreachable: the entry comes back from IndexedDB.
  await context.setOffline(false);
  await page.reload();
  await expect(rowOf(page, "Bakery")).toContainText("Waiting to sync");
  await expect(page.getByText("Offline · 1 change waiting")).toBeVisible();
  expect(server.puts).toBe(0);

  server.down = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect.poll(() => server.ledger.transactions.map((item) => item.title)).toContain("Bakery");
  await expect(page.getByText(/change waiting/)).toHaveCount(0);
});

test("keeps filters in the URL through Back, Forward and reload", async ({ context, page, isMobile }) => {
  await mockApi(context);
  await open(page, "/transactions?month=2026-11");
  await expect(results(page).getByRole("button", { name: /^Monthly salary/ })).toBeVisible();

  await page.getByRole("radio", { name: "Income" }).check();
  await expect(page).toHaveURL(/kind=income/);
  await expect(results(page).getByRole("button", { name: /^Rent/ })).toHaveCount(0);
  await expect(results(page).getByRole("link", { name: /Hydro/ })).toHaveCount(0);
  // The summary follows the period, not the type filter.
  if (!isMobile) await expect(page.locator(".activity-summary")).toContainText("spent $1,480.00");

  await stepPeriod(page, isMobile, "Previous month");
  await expect(page).toHaveURL(/month=2026-10/);
  // The desktop stepper names the month; the phone chip carries it in its name.
  await expect(page.getByText("October 2026").or(page.getByRole("button", { name: /^Period: October 2026\./ })).first()).toBeAttached();

  await page.goBack();
  await expect(page).toHaveURL(/month=2026-11/);
  await expect(page.getByRole("radio", { name: "Income" })).toBeChecked();
  await page.goForward();
  await expect(page).toHaveURL(/month=2026-10/);
  await page.goBack();

  await page.getByRole("searchbox", { name: "Search transactions" }).fill("salary");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/q=salary/);
  await page.reload();
  await expect(page.getByRole("searchbox", { name: "Search transactions" })).toHaveValue("salary");
  await expect(results(page).getByRole("button", { name: /^Monthly salary/ })).toBeVisible();
  await expect(page.getByText("1 matching transaction")).toBeVisible();
});

test("edits with a stale-version check and deletes after confirming", async ({ context, page }) => {
  const server = await mockApi(context);
  await open(page, "/transactions?month=2026-11");
  const row = results(page).getByRole("button", { name: /^Rent/ });
  await row.click();
  const detail = detailOf(page, "Rent");
  await detail.getByRole("button", { name: "Edit" }).click();
  const edit = form(page, "Edit entry");
  await edit.getByLabel("Title").fill("Rent, November");

  // Another device changes the same entry; this tab syncs when it regains focus.
  server.ledger = { ...server.ledger, transactions: server.ledger.transactions.map((item) => (item.id === "rent" ? { ...item, total: 150000, share: 150000 } : item)) };
  server.revision += 1;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  // The list behind the form shows the synced amount (on a desktop the detail panel steps aside while editing, MAZ-273).
  await expect(results(page)).toContainText("1,500.00");
  await page.getByRole("dialog", { name: "Edit entry" }).getByRole("button", { name: SAVE }).click();
  const banner = edit.getByRole("alert");
  await expect(banner).toContainText("This entry changed on another device");
  await expect(edit.getByLabel("Title")).toHaveValue("Rent, November");
  await banner.getByRole("button", { name: "Use their version" }).click();
  // Grouped as the cards draw it while not being typed (MAZ-226).
  await expect(edit.getByLabel("Amount (CAD)")).toHaveValue("1,500.00");
  await edit.getByLabel("Title").fill("Rent, November");
  await page.getByRole("dialog", { name: "Edit entry" }).getByRole("button", { name: SAVE }).click();
  await expect(page.getByText("Changes saved")).toBeVisible();
  await expect.poll(() => server.ledger.transactions.find((item) => item.id === "rent")).toMatchObject({ title: "Rent, November", total: 150000 });

  await results(page).getByRole("button", { name: /^Rent, November/ }).click();
  await detailOf(page, "Rent, November").getByRole("button", { name: "Delete", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Delete “Rent, November”?" });
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Rent, November deleted")).toBeVisible();
  await expect.poll(() => server.ledger.transactions.some((item) => item.id === "rent")).toBe(false);
  await expect(results(page).getByRole("button", { name: /^Rent/ })).toHaveCount(0);
});

test("selects several entries on a desktop, changes their category and account, deletes them, and undoes each in one save (MAZ-276)", async ({ context, page, isMobile }) => {
  test.skip(isMobile, "Selecting several entries is the desktop table's (web-activity-selected).");
  const server = await mockApi(context);
  server.ledger.accounts.push({ id: "visa", name: "Visa", type: "credit" });
  server.ledger.transactions.push(entry("coffee", "Coffee with Mira", { total: 1280, share: 640, categoryId: "food", date: "2026-11-09", accountId: "visa" }), entry("bus", "Transit pass", { total: 6200, share: 6200, date: "2026-11-06", accountId: "chq" }));
  // The offline store normalizes each entry, so compare entries by value, not by key order.
  const canonical = () => JSON.stringify(server.ledger.transactions.map((item) => Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))).sort((a, b) => String(a.id).localeCompare(String(b.id))));
  const original = canonical();
  await open(page, "/transactions?month=2026-11");
  await ledgerReady(page, false);
  const table = results(page);
  const bar = page.getByRole("toolbar", { name: /selected$/ });

  // `web-activity`: a box on each personal row, none on the shared one and none in the header yet.
  await expect(table.getByRole("checkbox", { name: "Select Rent" })).not.toBeChecked();
  await expect(rowOf(page, "Hydro").getByRole("checkbox")).toHaveCount(0);
  await expect(table.getByRole("checkbox", { name: "Select all listed entries" })).toHaveCount(0);

  // X ticks the focused row; the bar replaces the chips, the summary and Export.
  await table.getByRole("button", { name: /^Coffee with Mira/ }).focus();
  await page.keyboard.press("x");
  await expect(bar).toContainText("1 selected");
  await expect(page.getByRole("radio", { name: "Expenses" }).or(page.getByRole("button", { name: "Expenses" }))).toHaveCount(0);
  await table.getByRole("checkbox", { name: "Select Transit pass" }).click();
  await table.getByRole("checkbox", { name: "Select Monthly salary" }).click();
  await expect(bar).toContainText("3 selected");
  await expect(table.getByRole("checkbox", { name: "Select all listed entries" })).toHaveAttribute("aria-checked", "mixed");
  // Categories belong to one type: income and expenses together can't share one.
  await expect(bar.getByRole("button", { name: "Change category" })).toHaveAttribute("aria-disabled", "true");
  await table.getByRole("checkbox", { name: "Select Monthly salary" }).click();

  // Change category: one save for both, then Undo restores both in one more.
  let puts = server.puts;
  await bar.getByRole("button", { name: "Change category" }).click();
  const menu = page.getByRole("dialog", { name: "Category for 2 expenses" });
  await expect(menu.getByRole("button", { name: "Food & drinks, 1 of 2 already" })).toBeVisible();
  await expect(menu.getByText("Transit pass")).toHaveCount(0);
  await menu.getByRole("searchbox").fill("groc");
  await menu.getByRole("button", { name: /^Groceries/ }).click();
  await expect(page.getByText("2 entries moved to Groceries")).toBeVisible();
  await expect(bar).toHaveCount(0);
  await expect.poll(() => server.ledger.transactions.filter((item) => item.categoryId === "groceries").map((item) => item.id).sort()).toEqual(["bus", "coffee"]);
  expect(server.puts).toBe(puts + 1);
  puts = server.puts;
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(canonical).toBe(original);
  expect(server.puts).toBe(puts + 1);

  // Change account to none, then Esc clears a new selection.
  await table.getByRole("checkbox", { name: "Select Coffee with Mira" }).click();
  await table.getByRole("checkbox", { name: "Select all listed entries" }).click();
  await expect(bar).toContainText("4 selected");
  await bar.getByRole("button", { name: "Change account" }).click();
  await page.getByRole("dialog", { name: "Account for 4 entries" }).getByRole("button", { name: "No account" }).click();
  await expect(page.getByText("Account removed from 4 entries")).toBeVisible();
  await expect.poll(() => server.ledger.transactions.filter((item) => item.accountId).length).toBe(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(canonical).toBe(original);
  await table.getByRole("checkbox", { name: "Select Rent" }).click();
  await expect(bar).toContainText("1 selected");
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);

  // ⌫ with entries ticked asks to delete them all (`web-activity-bulk-delete`).
  await table.getByRole("checkbox", { name: "Select Coffee with Mira" }).click();
  await table.getByRole("checkbox", { name: "Select Rent" }).click();
  await table.getByRole("button", { name: /^Rent/ }).focus();
  await page.keyboard.press("Backspace");
  const confirm = page.getByRole("dialog", { name: "Delete 2 entries?" });
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expect(confirm.getByRole("listitem")).toHaveText([/Coffee with Mira/, /Rent/]);
  await confirm.getByRole("button", { name: "Delete 2 entries" }).click();
  await expect(page.getByText("2 entries deleted")).toBeVisible();
  await expect.poll(() => server.ledger.transactions.map((item) => item.id).sort()).toEqual(["bus", "pay"]);
  await expect(table.getByRole("button", { name: /^Rent/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => server.ledger.transactions.map((item) => item.id).sort()).toEqual(["bus", "coffee", "pay", "rent"]);
  await expect(table.getByRole("button", { name: /^Rent/ })).toBeVisible();
});

test("fits a 320px screen without horizontal scrolling", async ({ context, page }) => {
  await mockApi(context);
  await page.setViewportSize({ width: 320, height: 720 });
  await open(page, "/transactions?month=2026-11&category=groceries");
  await expect(results(page).getByRole("link", { name: /Hydro/ })).toBeVisible();
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBe(0);
  await page.getByRole("button", { name: "Add entry" }).click();
  await openExtras(form(page));
  await expect(form(page).getByLabel("Note")).toBeVisible();
  expect(await overflow()).toBe(0);
  // Save stays in view at the bottom of the dialog.
  await expect(page.getByRole("dialog", { name: "New entry" }).getByRole("button", { name: SAVE })).toBeInViewport();
});
