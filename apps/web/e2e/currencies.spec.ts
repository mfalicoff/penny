import type { BrowserContext, Page } from "@playwright/test";
import { expect, motionOff, test } from "./test";

// Entries in several currencies (MAZ-151 phase 1) in a real browser: adding a euro expense with the
// published rate and finding both amounts in Activity, a provisional rate, an edited rate, and a
// server with rates turned off. /api is mocked (a revision-checked ledger and `GET /api/rates`
// with the cards' sample rates: 1 EUR = 1.4612 CAD on Nov 3, 1.4630 on Friday Nov 6, the latest
// before Monday Nov 9). Synthetic data only.
//
// PENNY_MAZ151_CAPTURES=<dir> also writes the web cards' screens (light and dark) to <dir> for
// the design review (docs/design/visual-acceptance.md); without it those captures are skipped.

const EMAIL = "max@example.test";
const NOV_9 = Date.parse("2026-11-09T14:00:00Z");

type Entry = Record<string, unknown> & { id: string; title: string; date: string; total: number };

const category = (id: string, name: string, icon: string, color: string, kind = "expense") => ({ id, name, icon, color, kind });
const entry = (id: string, title: string, date: string, total: number, extra: Record<string, unknown> = {}): Entry => ({ id, title, kind: "expense", total, share: total, categoryId: "groceries", date, note: "", ...extra });

/** The cards' month: Max in CAD, with a provisional euro entry today, a US-dollar order and a cooking class in euros. */
function sampleLedger(foreign: boolean) {
  return {
    version: 4,
    currency: "CAD",
    accounts: [
      { id: "visa", name: "Visa", type: "credit" },
      { id: "chq", name: "Main chequing", type: "bank" },
    ],
    trips: [{ id: "lisbon", name: "Lisbon", startDate: "2026-11-02", endDate: "2026-11-19" }],
    categories: [
      category("fun", "Fun", "musical-notes-outline", "#C77DBA"),
      category("food", "Food & drinks", "cafe-outline", "#E47850"),
      category("groceries", "Groceries", "basket-outline", "#6C9C79"),
      category("transport", "Transport", "bus-outline", "#678DB1"),
      category("shopping", "Shopping", "bag-handle-outline", "#9D83BA"),
      category("invest", "Investments", "trending-up-outline", "#5B6CC9", "investment"),
      category("salary", "Salary", "briefcase-outline", "#6C9C79", "income"),
    ],
    transactions: [
      entry("rent", "Rent", "2026-11-01", 145000, { categoryId: "fun", accountId: "chq" }),
      entry("pay", "Payday", "2026-11-01", 320000, { kind: "income", categoryId: "salary", accountId: "chq" }),
      entry("transit", "Transit pass", "2026-11-06", 6200, { categoryId: "transport", accountId: "visa" }),
      entry("tfsa", "TFSA contribution", "2026-11-06", 20000, { kind: "investment", categoryId: "invest", accountId: "chq" }),
      entry("groceries", "Groceries", "2026-11-09", 4890, { accountId: "chq" }),
      entry("coffee", "Coffee with Mira", "2026-11-09", 1280, { share: 640, participants: 2, categoryId: "food", accountId: "visa" }),
      ...(foreign
        ? [
            entry("cooking", "Cooking class", "2026-11-03", 12420, { categoryId: "fun", accountId: "visa", tripId: "lisbon", note: "Pastéis de nata, Alfama", originalAmount: 8500, originalCurrency: "EUR", rate: "1.4612", rateStatus: "published", rateDate: "2026-11-03" }),
            entry("amazon", "Amazon.com order", "2026-11-06", 4807, { categoryId: "shopping", accountId: "visa", originalAmount: 3499, originalCurrency: "USD", rate: "1.3738", rateStatus: "published", rateDate: "2026-11-06" }),
            entry("museum", "Museum passes", "2026-11-09", 7022, { categoryId: "fun", accountId: "visa", tripId: "lisbon", originalAmount: 4800, originalCurrency: "EUR", rate: "1.463", rateStatus: "provisional", rateDate: "2026-11-06" }),
          ]
        : []),
    ],
    recurring: [],
  };
}

interface Server {
  revision: number;
  ledger: ReturnType<typeof sampleLedger>;
  ratesEnabled: boolean;
  rateRequests: string[];
}

function ratesFor(date: string, enabled: boolean) {
  if (!enabled) return { enabled: false, source: null, base: "CAD", date, rateDate: null, provisional: false, latestDate: null, rates: {} };
  const provisional = date > "2026-11-06";
  const rateDate = provisional ? "2026-11-06" : date;
  const rates = rateDate === "2026-11-06" ? { EUR: "1.463", USD: "1.3738", JPY: "0.008964" } : { EUR: "1.4612", USD: "1.373", JPY: "0.008953" };
  return { enabled: true, source: "European Central Bank", base: "CAD", date, rateDate, provisional, latestDate: "2026-11-06", rates };
}

async function mockApi(context: BrowserContext, options: { foreign?: boolean; ratesEnabled?: boolean } = {}): Promise<Server> {
  const server: Server = { revision: 4, ledger: sampleLedger(options.foreign ?? false), ratesEnabled: options.ratesEnabled ?? true, rateRequests: [] };
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/info") return route.fulfill({ json: { name: "penny", version: "2.4.0-e2e" } });
    if (url.pathname === "/api/auth/me") return route.fulfill({ json: { email: EMAIL } });
    if (url.pathname === "/api/auth/oidc") return route.fulfill({ json: { enabled: false, providers: [] } });
    if (url.pathname === "/api/receipt-email") return route.fulfill({ json: { enabled: false, domain: null, address: null } });
    if (url.pathname === "/api/households") return route.fulfill({ json: { households: [] } });
    if (url.pathname === "/api/households/projection") return route.fulfill({ json: { transactions: [], scheduled: [] } });
    if (url.pathname === "/api/rates") {
      const date = url.searchParams.get("date") ?? "2026-11-09";
      server.rateRequests.push(date);
      return route.fulfill({ json: ratesFor(date, server.ratesEnabled) });
    }
    if (url.pathname === "/api/ledger") {
      if (request.method() === "PUT") {
        const body = request.postDataJSON() as { revision: number; ledger: Server["ledger"] };
        if (body.revision !== server.revision) return route.fulfill({ status: 409, json: { error: "The ledger changed.", code: "ledger.conflict" } });
        server.revision += 1;
        server.ledger = body.ledger;
      }
      return route.fulfill({ json: { revision: server.revision, ledger: server.ledger } });
    }
    if (url.pathname === "/api/v1/search/transactions") {
      const body = request.postDataJSON() as { from?: string; to?: string };
      const items = (server.ledger.transactions)
        .filter((item) => (!body.from || item.date >= body.from) && (!body.to || item.date <= body.to))
        .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
        .map((item) => ({ key: `personal:${item.id}`, source: "personal", match: null, entry: item }));
      return route.fulfill({ json: { version: 1, items, totalCount: items.length, nextCursor: null } });
    }
    return route.fulfill({ status: 404, json: { error: "API route not found." } });
  });
  return server;
}

async function open(page: Page, path: string) {
  await page.clock.setFixedTime(NOV_9);
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

const form = (page: Page) => page.getByRole("form", { name: "New entry" });
const results = (page: Page) => page.getByRole("region", { name: "Search results" });

/** Opens Add entry, types an amount and a title, and picks a currency from the menu. */
async function startEntry(page: Page, { amount, title, code, date }: { amount: string; title: string; code: string; date?: string }) {
  await page.keyboard.press("n");
  const add = form(page);
  await expect(add).toBeVisible();
  if (date) await add.getByLabel("Date").fill(date);
  await add.getByRole("button", { name: /^Currency: CAD/ }).click();
  const menu = add.getByRole("dialog", { name: "Currency" });
  await menu.getByRole("searchbox", { name: "Search currencies" }).fill(code);
  await menu.getByRole("searchbox", { name: "Search currencies" }).press("Enter");
  await expect(add.getByRole("button", { name: new RegExp(`^Currency: ${code}`) })).toBeFocused();
  await add.getByLabel(`Amount (${code})`).fill(amount);
  await add.getByLabel("Title").fill(title);
  return add;
}

test("adds an expense in euros and shows both amounts in Activity", async ({ context, page, isMobile }) => {
  const server = await mockApi(context);
  await open(page, "/transactions?month=2026-11");
  await expect(results(page).getByRole("button", { name: /^Groceries/ }).first()).toBeVisible();

  const add = await startEntry(page, { amount: "85.00", title: "Cooking class", code: "EUR", date: "2026-11-03" });
  // The converted amount follows the published rate for the date, with its source.
  await expect(add.getByText("≈ $124.20 CAD")).toBeVisible();
  await expect(add.getByText("1 EUR = 1.4612 CAD")).toBeVisible();
  await expect(add.getByText(/European Central Bank · Nov 3/)).toBeVisible();
  // Schedules stay in the home currency: Repeat is Never and can't change (desktop and tablet rows).
  if (!isMobile) await expect(add.getByRole("combobox", { name: "Repeat" })).toBeDisabled();
  await page.keyboard.press("ControlOrMeta+Enter");

  await expect(page.getByText("Expense added")).toBeVisible();
  await expect.poll(() => (server.ledger.transactions).find((item) => item.title === "Cooking class")).toMatchObject({
    total: 12420,
    share: 12420,
    originalAmount: 8500,
    originalCurrency: "EUR",
    rate: "1.4612",
    rateStatus: "published",
    rateDate: "2026-11-03",
  });
  const row = results(page).getByRole("row").or(results(page).getByRole("listitem")).filter({ hasText: "Cooking class" });
  await expect(row).toContainText("−$124.20");
  await expect(row).toContainText("€85.00");
});

test("an entry dated today uses Friday's rate, provisionally, and an edited rate is kept", async ({ context, page }) => {
  const server = await mockApi(context);
  await open(page, "/transactions?month=2026-11");
  const add = await startEntry(page, { amount: "48.00", title: "Museum passes", code: "EUR" });
  await expect(add.getByText("≈ $70.22 CAD")).toBeVisible();
  await expect(add.getByText("Provisional", { exact: true })).toBeVisible();
  await expect(add.getByText("Today's rate isn't out yet, so Penny uses Friday's. It's updated on the next sync, unless you change it.")).toBeVisible();

  await add.getByRole("button", { name: /^Edit the rate/ }).click();
  const rate = add.getByRole("textbox", { name: "Exchange rate: CAD for 1 EUR" });
  await expect(rate).toBeFocused();
  await rate.fill("1.49");
  await expect(add.getByText("Edited", { exact: true })).toBeVisible();
  await expect(add.getByText("≈ $71.52 CAD")).toBeVisible();
  await expect(add.getByText("European Central Bank: 1.4630")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByText("Expense added")).toBeVisible();
  await expect.poll(() => (server.ledger.transactions).find((item) => item.title === "Museum passes")).toMatchObject({ total: 7152, originalAmount: 4800, rate: "1.49", rateStatus: "edited" });
  expect((server.ledger.transactions).find((item) => item.title === "Museum passes")).not.toHaveProperty("rateDate");
});

test("with rates off, Save waits for a rate and suggests the last one", async ({ context, page }) => {
  const server = await mockApi(context, { foreign: true, ratesEnabled: false });
  await open(page, "/transactions?month=2026-11");
  const add = await startEntry(page, { amount: "20.00", title: "Tram tickets", code: "EUR" });
  await expect(add.getByText("Enter a rate to convert")).toBeVisible();
  await expect(add.getByText(/Your server doesn't fetch exchange rates\. Enter the rate you got, or/)).toBeVisible();
  const save = add.getByRole("button", { name: /^Add expense/ });
  await expect(save).toHaveAttribute("aria-disabled", "true");
  // It still answers a press (as ⌘↵ does): the Rate row shakes and says what's missing.
  await save.click({ force: true });
  await expect(add.getByText("Enter the exchange rate.")).toBeVisible();
  await expect(add.getByRole("textbox", { name: "Exchange rate: CAD for 1 EUR" })).toBeFocused();

  // The latest euro entry (Museum passes, today) was converted at 1.4630.
  await add.getByRole("button", { name: "use your last one (1.4630)" }).click();
  await expect(add.getByText("≈ $29.26 CAD")).toBeVisible();
  await save.click();
  await expect(page.getByText("Expense added")).toBeVisible();
  await expect.poll(() => (server.ledger.transactions).find((item) => item.title === "Tram tickets")).toMatchObject({ total: 2926, rate: "1.463", rateStatus: "edited" });
});

test("Activity and its detail show the original amount and the exchange rate", async ({ context, page, isMobile }) => {
  test.skip(isMobile, "The detail beside the table is the desktop card (web-activity-currencies).");
  await mockApi(context, { foreign: true });
  await open(page, "/transactions?month=2026-11");
  const row = (title: string) => results(page).getByRole("row").filter({ hasText: title });
  await expect(row("Museum passes")).toContainText("−$70.22");
  await expect(row("Museum passes")).toContainText("€48.00 · provisional");
  await expect(row("Amazon.com order")).toContainText("US$34.99");
  await row("Cooking class").getByRole("button", { name: /^Cooking class/ }).click();
  const detail = page.getByRole("complementary", { name: "Cooking class" });
  await expect(detail).toContainText("−€85.00");
  await expect(detail).toContainText("$124.20 CAD");
  await expect(detail.getByRole("heading", { name: "Exchange rate" })).toBeVisible();
  await expect(detail).toContainText("1 EUR = 1.4612 CAD");
  await expect(detail).toContainText("European Central Bank");
  await expect(detail).toContainText("Your totals use $124.20. To use your card's rate instead, edit the entry and change its rate.");
});

test("Settings › Currency shows the exchange rates and recent currencies", async ({ context, page }) => {
  const server = await mockApi(context, { foreign: true });
  await open(page, "/settings/currency");
  await expect(page.getByText("European Central Bank reference rates")).toBeVisible();
  await expect(page.getByText("Fri, Nov 6")).toBeVisible();
  await expect(page.getByText("Used twice")).toBeVisible();
  await expect(page.getByText("Used once")).toBeVisible();
  expect(server.rateRequests).toContain("2026-11-09");
});

// ---------- card captures for the design review (PENNY_MAZ151_CAPTURES) ----------

const captures = process.env.PENNY_MAZ151_CAPTURES;

async function capture(page: Page, name: string, scheme: "light" | "dark") {
  // Let rows that are rising in finish first (motion is turned off only for what starts next).
  await page.waitForTimeout(800);
  await motionOff(page);
  await page.mouse.move(1, 1);
  await page.screenshot({ path: `${captures ?? ""}/${name}.${scheme}.png` });
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`card captures (${scheme})`, () => {
    test.skip(!captures, "Set PENNY_MAZ151_CAPTURES to a directory to capture the cards.");
    test.use({ colorScheme: scheme });

    test("web cards", async ({ context, page, isMobile }) => {
      test.skip(isMobile, "web-* cards are desktop captures.");
      await page.setViewportSize({ width: 1440, height: 900 });
      const server = await mockApi(context, { foreign: true });
      await open(page, "/transactions?month=2026-11");

      let add = await startEntry(page, { amount: "85.00", title: "Cooking class", code: "EUR", date: "2026-11-03" });
      await add.getByRole("radio", { name: "Fun" }).check({ force: true });
      await add.getByRole("combobox", { name: "Account" }).selectOption({ label: "Visa" });
      await add.getByRole("combobox", { name: "Trip" }).selectOption({ label: "Lisbon" });
      await expect(add.getByText("≈ $124.20 CAD")).toBeVisible();
      await add.getByRole("button", { name: /^Currency: EUR/ }).click();
      await capture(page, "web-add-entry-currency", scheme);
      await page.keyboard.press("Escape");

      await add.getByRole("button", { name: /^Edit the rate/ }).click();
      await add.getByRole("textbox", { name: "Exchange rate: CAD for 1 EUR" }).fill("1.4900");
      await expect(add.getByText("≈ $126.65 CAD")).toBeVisible();
      await capture(page, "web-entry-rate-edited", scheme);

      await add.getByRole("button", { name: "Use it" }).click();
      await add.getByLabel("Date").fill("2026-11-09");
      await add.getByLabel("Amount (EUR)").fill("48.00");
      await add.getByLabel("Title").fill("Museum passes");
      await expect(add.getByText("≈ $70.22 CAD")).toBeVisible();
      await capture(page, "web-entry-rate-provisional", scheme);
      await page.keyboard.press("Escape");
      await expect(add).toHaveCount(0);

      server.ratesEnabled = false;
      await page.reload();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      add = await startEntry(page, { amount: "85.00", title: "Cooking class", code: "EUR", date: "2026-11-03" });
      await add.getByRole("radio", { name: "Fun" }).check({ force: true });
      await add.getByRole("combobox", { name: "Account" }).selectOption({ label: "Visa" });
      await add.getByRole("combobox", { name: "Trip" }).selectOption({ label: "Lisbon" });
      await add.getByRole("textbox", { name: "Exchange rate: CAD for 1 EUR" }).focus();
      await capture(page, "web-entry-rate-manual", scheme);

      await page.goto("/settings/currency");
      await expect(page.getByText("Turned off on this server")).toBeVisible();
      await capture(page, "web-currency-rates-off", scheme);
      server.ratesEnabled = true;
      await page.reload();
      await expect(page.getByText("European Central Bank reference rates")).toBeVisible();
      await capture(page, "web-currency-rates", scheme);
      // web-currency draws the same screen (redrawn to the currency and rates card, 2026-11-27).
      await capture(page, "web-currency", scheme);

      await page.goto("/transactions?month=2026-11");
      await results(page).getByRole("row").filter({ hasText: "Cooking class" }).getByRole("button", { name: /^Cooking class/ }).click();
      await expect(page.getByRole("complementary", { name: "Cooking class" })).toBeVisible();
      await capture(page, "web-activity-currencies", scheme);
    });

    test("home recent (phone)", async ({ context, page }) => {
      await page.setViewportSize({ width: 402, height: 874 });
      await mockApi(context, { foreign: true });
      await open(page, "/");
      await expect(page.getByText("provisional rate")).toBeVisible();
      await capture(page, "iphone-home-currencies.web", scheme);
    });

    test("settings currency (phone)", async ({ context, page }) => {
      await page.setViewportSize({ width: 402, height: 874 });
      await mockApi(context, { foreign: true });
      await open(page, "/settings/currency");
      await expect(page.getByText("European Central Bank reference rates")).toBeVisible();
      await capture(page, "iphone-currency.web", scheme);
    });
  });
}
