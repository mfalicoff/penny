import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// MAZ-96 large-ledger performance budgets in a real browser over the production build: a
// synthetic ledger of 20,000 entries across 24 months (made-up titles and amounts), served by a
// mocked revision-checked /api/ledger and a substring search stand-in, so the numbers measure the
// browser (download, IndexedDB, Home's report, Activity's rows, offline search) rather than the
// server. Server search latency is measured against .NET/PostgreSQL in search.real.spec.ts.
//
// Budgets are wall-clock on the test host with generous headroom for CI runners; each measured
// value is attached to the test as an annotation and in results.json.

const EMAIL = "perf@example.test";
const ENTRIES = 20_000;
const NOW = Date.parse("2026-11-10T15:00:00Z");
const BUDGET = { firstHome: 2_500, monthChange: 750, activity: 2_000, offlineSearch: 1_000, longestTask: 500 };

const TITLES = ["Groceries", "Coffee", "Rent", "Transit", "Pharmacy", "Bookshop", "Dinner out", "Hardware", "Streaming", "Gym"];

function ledger() {
  const transactions = Array.from({ length: ENTRIES }, (_, index) => {
    const month = 23 - (index % 24);
    const date = new Date(Date.UTC(2026, 10 - month, 1 + (index % 27)));
    const kind = index % 25 === 0 ? "income" : index % 40 === 0 ? "investment" : "expense";
    const total = kind === "income" ? 420_000 : 500 + ((index * 37) % 15_000);
    return { id: `perf-${String(index)}`, title: `${TITLES[index % TITLES.length] ?? "Entry"} ${String(index)}`, kind, total, share: total, categoryId: kind === "income" ? "salary" : kind === "investment" ? "invest" : "food", date: date.toISOString().slice(0, 10), note: index % 3 === 0 ? "synthetic note" : "" };
  });
  return {
    version: 4,
    currency: "CAD",
    accounts: [{ id: "chq", name: "Chequing", type: "bank" }],
    trips: [],
    categories: [
      { id: "food", name: "Food", icon: "cafe-outline", color: "#E47850", kind: "expense" },
      { id: "salary", name: "Salary", icon: "briefcase-outline", color: "#6C9C79", kind: "income" },
      { id: "invest", name: "Investments", icon: "trending-up-outline", color: "#678DB1", kind: "investment" },
    ],
    transactions,
    recurring: [],
  };
}

async function mockApi(context: BrowserContext) {
  const state = { revision: 1, ledger: ledger(), down: false };
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/info") return route.fulfill({ json: { name: "penny", version: "2.0.0-e2e" } });
    if (url.pathname === "/api/auth/me") return route.fulfill({ json: { email: EMAIL } });
    if (url.pathname === "/api/auth/oidc") return route.fulfill({ json: { enabled: false } });
    if (state.down) return route.abort("connectionrefused");
    if (url.pathname === "/api/ledger") return route.fulfill({ json: { revision: state.revision, ledger: state.ledger } });
    if (url.pathname === "/api/households/projection") return route.fulfill({ json: { transactions: [], scheduled: [] } });
    if (url.pathname === "/api/v1/search/transactions") {
      const body = request.postDataJSON() as { query?: string; from?: string; to?: string; pageSize?: number; cursor?: string };
      const query = body.query?.toLowerCase() ?? "";
      const matching = state.ledger.transactions
        .filter((item) => (!body.from || item.date >= body.from) && (!body.to || item.date <= body.to) && item.title.toLowerCase().includes(query))
        .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
      const start = body.cursor ? Number(body.cursor) : 0;
      const size = body.pageSize ?? 50;
      const items = matching.slice(start, start + size).map((entry) => ({ key: `personal:${entry.id}`, source: "personal", match: query ? "title" : null, entry }));
      return route.fulfill({ json: { version: 1, items, totalCount: matching.length, nextCursor: start + size < matching.length ? String(start + size) : null } });
    }
    return route.fulfill({ status: 404, json: { error: "API route not found." } });
  });
  return state;
}

/** Records long tasks (main-thread blocks over 50 ms) from page load on. */
async function watchLongTasks(page: Page) {
  await page.addInitScript(() => {
    const store = ((window as unknown as { __longTasks: number[] }).__longTasks = []);
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) store.push(entry.duration);
    }).observe({ type: "longtask", buffered: true });
  });
  return () => page.evaluate(() => Math.max(0, ...(window as unknown as { __longTasks: number[] }).__longTasks));
}

function record(name: string, ms: number, budget: number) {
  test.info().annotations.push({ type: "performance", description: `${name}: ${ms.toFixed(0)} ms (budget ${String(budget)} ms)` });
  expect(ms, `${name} took ${ms.toFixed(0)} ms`).toBeLessThan(budget);
}

test("a 20,000-entry ledger opens Home, changes month, lists Activity and searches offline inside the budgets", async ({ context, page, browserName }) => {
  test.skip(browserName !== "chromium", "long-task timing is Chromium-only");
  const server = await mockApi(context);
  const longest = await watchLongTasks(page);
  await page.clock.setFixedTime(NOW);

  let started = performance.now();
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Left to spend" }).locator(".hero__amount")).toBeVisible();
  await expect(page.getByRole("region", { name: "Left to spend" }).locator(".hero__amount")).not.toHaveText(/\$0\.00$/);
  record("first Home with the full ledger", performance.now() - started, BUDGET.firstHome);

  started = performance.now();
  await page.getByRole("button", { name: "Previous month" }).first().click();
  await expect(page.getByText("October 2026").first()).toBeVisible();
  record("Home month change", performance.now() - started, BUDGET.monthChange);

  started = performance.now();
  await page.goto("/transactions?month=2026-10");
  await expect(page.getByRole("region", { name: "Search results" }).getByRole("status")).toHaveText(/matching transactions/);
  await expect(page.getByRole("region", { name: "October 2026" })).toBeVisible();
  record("Activity month with totals", performance.now() - started, BUDGET.activity);

  // Offline, Activity searches this browser's copy of all 20,000 entries.
  server.down = true;
  await context.setOffline(true);
  started = performance.now();
  const search = page.getByRole("searchbox", { name: "Search transactions" });
  await search.fill("coffee 1");
  await search.press("Enter");
  await expect(page.getByRole("region", { name: "Search results" }).getByRole("status")).toHaveText(/on this device/);
  record("offline search over the whole ledger", performance.now() - started, BUDGET.offlineSearch);
  await context.setOffline(false);

  record("longest main-thread task", await longest(), BUDGET.longestTask);
});
