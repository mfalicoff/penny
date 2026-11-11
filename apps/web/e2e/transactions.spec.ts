import { expect, test, type BrowserContext, type Page } from "@playwright/test";

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
    if (url.pathname === "/api/auth/oidc") return route.fulfill({ json: { enabled: false } });
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
const form = (page: Page, name = "Add entry") => page.getByRole("form", { name });

test("adds an expense with the keyboard only and finds it in Activity", async ({ context, page }) => {
  const server = await mockApi(context);
  await open(page, "/transactions?month=2026-11");
  await expect(results(page).getByRole("link", { name: /Hydro/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "November 2026" })).toBeVisible();

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
  await expect(results(page).getByRole("button", { name: /Coffee beans/ })).toBeVisible();
  await expect.poll(() => server.ledger.transactions.map((item) => item.title)).toContain("Coffee beans");
  expect(server.ledger.transactions.find((item) => item.title === "Coffee beans")).toMatchObject({ total: 1840, share: 1840, categoryId: "groceries", date: "2026-11-06" });
  await expect(page.getByRole("region", { name: "November 2026" }).getByText("Spent", { exact: true }).locator("..")).toContainText("$1,498.40");
});

test("keeps the draft through a closed dialog and an inline category, and validates before saving", async ({ context, page }) => {
  const server = await mockApi(context);
  await open(page, "/");
  await page.getByRole("button", { name: "Add entry" }).click();
  let add = form(page);
  await add.getByLabel("Amount (CAD)").fill("62");
  await page.getByRole("dialog", { name: "Add entry" }).getByRole("button", { name: "Save" }).click();
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
  const picker = page.getByRole("dialog", { name: "Choose a category" });
  await picker.getByLabel("New category").fill("Pets");
  await picker.getByRole("button", { name: "Add category" }).click();
  await expect(picker).toHaveCount(0);
  await expect(add.getByRole("radio", { name: "Pets" })).toBeChecked();
  await expect(add.getByLabel("Amount (CAD)")).toHaveValue("62");
  await page.getByRole("dialog", { name: "Add entry" }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Expense added")).toBeVisible();
  await expect.poll(() => server.ledger.categories.map((category) => category.name)).toContain("Pets");
  await expect.poll(() => server.ledger.transactions.find((item) => item.title === "Vet visit")?.total).toBe(6200);
});

test("saves offline, keeps the entry through a reload, and syncs it once back online", async ({ context, page }) => {
  const server = await mockApi(context);
  await open(page, "/transactions?month=2026-11");
  await expect(results(page).getByRole("button", { name: /Rent/ })).toBeVisible();
  // The ledger has downloaded once (the totals come from it), so it can be added to offline.
  await expect(page.getByRole("region", { name: "November 2026" })).toBeVisible();

  server.down = true;
  await context.setOffline(true);
  await page.getByRole("button", { name: "Add entry" }).click();
  const add = form(page);
  await add.getByLabel("Amount (CAD)").fill("7.50");
  await add.getByLabel("Title").fill("Bakery");
  await add.getByLabel("Date").fill("2026-11-08");
  await page.getByRole("dialog", { name: "Add entry" }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved on this device. It syncs when you're back online.")).toBeVisible();
  await expect(results(page).getByRole("listitem").filter({ hasText: "Bakery" })).toContainText("Waiting to sync");
  // Shared rows stay visible from what Penny last loaded.
  await expect(results(page).getByRole("link", { name: /Hydro/ })).toBeVisible();
  await expect(results(page)).toContainText("on this device");

  // Reload with the network back but the server still unreachable: the entry comes back from IndexedDB.
  await context.setOffline(false);
  await page.reload();
  await expect(results(page).getByRole("listitem").filter({ hasText: "Bakery" })).toContainText("Waiting to sync");
  await expect(page.getByText("Not synced · 1 change waiting")).toBeVisible();
  expect(server.puts).toBe(0);

  server.down = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect.poll(() => server.ledger.transactions.map((item) => item.title)).toContain("Bakery");
  await expect(page.getByText(/change waiting/)).toHaveCount(0);
});

test("keeps filters in the URL through Back, Forward and reload", async ({ context, page }) => {
  await mockApi(context);
  await open(page, "/transactions?month=2026-11");
  await expect(results(page).getByRole("button", { name: /Monthly salary/ })).toBeVisible();

  await page.getByRole("radio", { name: "Income" }).check();
  await expect(page).toHaveURL(/kind=income/);
  await expect(results(page).getByRole("button", { name: /Rent/ })).toHaveCount(0);
  await expect(results(page).getByRole("link", { name: /Hydro/ })).toHaveCount(0);
  // Totals follow the period, not the type filter.
  await expect(page.getByRole("region", { name: "November 2026" }).getByText("Spent", { exact: true }).locator("..")).toContainText("$1,480.00");

  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(page).toHaveURL(/month=2026-10/);
  await expect(page.getByRole("region", { name: "October 2026" })).toBeVisible();

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
  await expect(results(page).getByRole("button", { name: /Monthly salary/ })).toBeVisible();
  await expect(page.getByText("1 matching transaction")).toBeVisible();
});

test("edits with a stale-version check and deletes after confirming", async ({ context, page }) => {
  const server = await mockApi(context);
  await open(page, "/transactions?month=2026-11");
  const row = results(page).getByRole("button", { name: /Rent/ });
  await row.click();
  const detail = page.getByRole("dialog", { name: "Rent" });
  await detail.getByRole("button", { name: "Edit" }).click();
  const edit = form(page, "Edit entry");
  await edit.getByLabel("Title").fill("Rent, November");

  // Another device changes the same entry; this tab syncs when it regains focus.
  server.ledger = { ...server.ledger, transactions: server.ledger.transactions.map((item) => (item.id === "rent" ? { ...item, total: 150000, share: 150000 } : item)) };
  server.revision += 1;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(detail).toContainText("$1,500.00");
  await page.getByRole("dialog", { name: "Edit entry" }).getByRole("button", { name: "Save" }).click();
  const banner = edit.getByRole("alert");
  await expect(banner).toContainText("This entry changed on another device");
  await expect(edit.getByLabel("Title")).toHaveValue("Rent, November");
  await banner.getByRole("button", { name: "Use their version" }).click();
  await expect(edit.getByLabel("Amount (CAD)")).toHaveValue("1500.00");
  await edit.getByLabel("Title").fill("Rent, November");
  await page.getByRole("dialog", { name: "Edit entry" }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Changes saved")).toBeVisible();
  await expect.poll(() => server.ledger.transactions.find((item) => item.id === "rent")).toMatchObject({ title: "Rent, November", total: 150000 });

  await results(page).getByRole("button", { name: /Rent, November/ }).click();
  await page.getByRole("dialog", { name: "Rent, November" }).getByRole("button", { name: "Delete" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete Rent, November?" });
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Rent, November deleted")).toBeVisible();
  await expect.poll(() => server.ledger.transactions.some((item) => item.id === "rent")).toBe(false);
  await expect(results(page).getByRole("button", { name: /Rent/ })).toHaveCount(0);
});

test("fits a 320px screen without horizontal scrolling", async ({ context, page }) => {
  await mockApi(context);
  await page.setViewportSize({ width: 320, height: 720 });
  await open(page, "/transactions?month=2026-11&category=groceries");
  await expect(results(page).getByRole("link", { name: /Hydro/ })).toBeVisible();
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBe(0);
  await page.getByRole("button", { name: "Add entry" }).click();
  await form(page).getByRole("button", { name: /More details/ }).click();
  await expect(form(page).getByLabel("Note")).toBeVisible();
  expect(await overflow()).toBe(0);
  // Save stays in view at the bottom of the dialog.
  await expect(page.getByRole("dialog", { name: "Add entry" }).getByRole("button", { name: "Save" })).toBeInViewport();
});
