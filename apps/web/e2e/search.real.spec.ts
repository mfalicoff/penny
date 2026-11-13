import { expect, test, type Page } from "@playwright/test";
import { LedgerClient, pinClock, realStack, scenarioDefinition, seedScenario, signIn, skipReason, type SearchPage, type SeedContext, type Session } from "./stack";

// MAZ-96: .NET/PostgreSQL search journeys in the browser over the shared `searchable-household`
// seed (contracts/fixtures/full-stack-seeds.json), the same scenario and published expectations
// the C# FullStackSeedTests and the iOS search fixtures use. For every published expectation the
// API's ordered keys, the browser's rows and the private exclusions must agree; then category and
// account renames, offline create/edit/delete with reconnect (no duplicates) and latency budgets.
// In apps/web:
//
//   npm run build && npm run test:e2e:real -- search.real --project=chromium-desktop
//
// Seeding pins the server clock to 2026-10-15; the browser clock is pinned to the same instant.
test.skip(!realStack, skipReason);
test.describe.configure({ mode: "serial", timeout: 180_000 });

const AT = "2026-10-15T12:00:00Z";

interface Expectation {
  as: string;
  request: { query: string };
  keys: string[];
  matches: (string | null)[];
  meaningAllowedAfter: boolean;
  excludes: string[];
  why: string;
}

interface Step {
  as?: string;
  ledger?: { transactions: { id: string; title: string }[] };
  expense?: { ref: string; body: { title: string } };
}

interface Scenario {
  steps: Step[];
  searchExpectations: Expectation[];
}

const definition = scenarioDefinition("searchable-household") as Scenario;
const titles = new Map<string, string>();
for (const step of definition.steps) {
  for (const entry of step.ledger?.transactions ?? []) titles.set(`personal:${entry.id}`, entry.title);
  if (step.expense) titles.set(`shared:$expense:${step.expense.ref}`, step.expense.body.title);
}

let seed: SeedContext;
const sessions = new Map<string, Session>();
const clients = new Map<string, LedgerClient>();
const latencies: { query: string; ms: number }[] = [];

/** `shared:$expense:ref` → `shared:<server id>`. */
function resolve(key: string) {
  const match = /^shared:\$expense:(.+)$/.exec(key);
  if (!match?.[1]) return key;
  const id = seed.expenseIds[match[1]];
  if (!id) throw new Error(`No seeded expense ${match[1]}`);
  return `shared:${id}`;
}

async function session(alias: string, baseURL: string | undefined, browser: Parameters<typeof signIn>[0]) {
  let found = sessions.get(alias);
  if (!found) {
    const user = seed.users[alias];
    if (!user) throw new Error(`No seeded user ${alias}`);
    found = await signIn(browser, baseURL, user, AT);
    sessions.set(alias, found);
  }
  return found.page;
}

function client(alias: string) {
  const found = clients.get(alias);
  if (found) return found;
  const user = seed.users[alias];
  if (!user) throw new Error(`No seeded user ${alias}`);
  const created = new LedgerClient(user.token);
  clients.set(alias, created);
  return created;
}

async function timedSearch(alias: string, request: { query: string } & Record<string, unknown>): Promise<SearchPage> {
  const started = performance.now();
  const page = await client(alias).search(request);
  latencies.push({ query: request.query, ms: performance.now() - started });
  return page;
}

const results = (page: Page) => page.getByRole("region", { name: "Search results" });

/** Searches in Activity (all time) and returns the row titles in order once results have loaded. */
async function searchInBrowser(page: Page, query: string) {
  const started = Date.now();
  await page.goto(query ? `/transactions?q=${encodeURIComponent(query)}` : "/transactions");
  await expect(results(page).getByRole("status")).toHaveText(/matching transaction|No matching/);
  const elapsed = Date.now() - started;
  return { titles: await results(page).locator(".results__title").allInnerTexts(), elapsed };
}

test.beforeAll(() => {
  seed = seedScenario("searchable-household");
});

test.afterAll(async () => {
  for (const { context } of sessions.values()) await context.close();
  await pinClock(null);
});

test("every published search expectation holds on the API and in the browser, privately per viewer", async ({ browser, baseURL }) => {
  for (const expectation of definition.searchExpectations) {
    const label = `${expectation.as} "${expectation.request.query}" (${expectation.why})`;
    const expected = expectation.keys.map(resolve);
    const server = await timedSearch(expectation.as, { ...expectation.request, pageSize: 50 });
    const keys = server.items.map((item) => item.key);
    if (expectation.meaningAllowedAfter) {
      expect(keys.slice(0, expected.length), label).toEqual(expected);
      // Anything after the published keys may only be a meaning match.
      expect(server.items.slice(expected.length).every((item) => item.match === "meaning"), label).toBe(true);
    } else {
      expect(keys, label).toEqual(expected);
      expect(server.totalCount, label).toBe(expected.length);
    }
    expect(server.items.slice(0, expected.length).map((item) => item.match), label).toEqual(expectation.matches);
    for (const excluded of expectation.excludes.map(resolve)) expect(keys, `${label} must not see ${excluded}`).not.toContain(excluded);

    const page = await session(expectation.as, baseURL, browser);
    const shown = await searchInBrowser(page, expectation.request.query);
    const expectedTitles = expectation.keys.map((key) => titles.get(key));
    expect(shown.titles.slice(0, expectedTitles.length), label).toEqual(expectedTitles);
    for (const excluded of expectation.excludes) {
      if (excluded.startsWith("personal:")) await expect(results(page).locator(`[data-row-key="${excluded}"]`), label).toHaveCount(0);
      else await expect(results(page).locator(`a[href$="/expenses/${resolve(excluded).slice("shared:".length)}"]`), label).toHaveCount(0);
    }
    // Browser budget (MAZ-96): navigate, query and render results within 3 s on the test host.
    expect(shown.elapsed, `${label}: browser search took ${String(shown.elapsed)} ms`).toBeLessThan(3_000);
  }
});

test("paging is deterministic: two-row pages walk exactly the full list, with no repeats", async () => {
  for (const alias of ["alex", "bea", "cam"]) {
    const full = await timedSearch(alias, { query: "", pageSize: 50 });
    const walked: string[] = [];
    let cursor: string | null = null;
    do {
      const next: SearchPage = await timedSearch(alias, { query: "", pageSize: 2, ...(cursor ? { cursor } : {}) });
      expect(next.totalCount).toBe(full.totalCount);
      walked.push(...next.items.map((item) => item.key));
      cursor = next.nextCursor;
    } while (cursor);
    expect(walked, alias).toEqual(full.items.map((item) => item.key));
    expect(new Set(walked).size).toBe(walked.length);
  }
  // Filters are applied by the server, inside the same ordering.
  const october = await timedSearch("alex", { query: "", from: "2026-10-01", to: "2026-10-31", kind: "expense", pageSize: 50 });
  expect(october.items.length).toBeGreaterThan(0);
  expect(october.items.every((item) => item.entry.date >= "2026-10-01" && item.entry.date <= "2026-10-31")).toBe(true);
});

test("renaming a category and an account in the browser changes what search finds", async ({ browser, baseURL }) => {
  const page = await session("alex", baseURL, browser);
  await page.goto("/categories");
  await page.getByRole("button", { name: "Edit Groceries & dining" }).click();
  const category = page.getByRole("dialog", { name: "Edit category" });
  await category.getByLabel("Name").fill("Eating out");
  await category.getByRole("button", { name: "Save" }).click();
  await expect(category).toBeHidden();

  await page.goto("/accounts");
  await page.getByRole("button", { name: "Edit Everyday chequing" }).click();
  const account = page.getByRole("dialog", { name: "Edit account" });
  await account.getByLabel("Name").fill("Daily bank");
  await account.getByRole("button", { name: "Save" }).click();
  await expect(account).toBeHidden();

  // The server re-indexes in the same transaction as the ledger write.
  await expect
    .poll(async () => (await timedSearch("alex", { query: "eating out", pageSize: 50 })).items.filter((item) => item.match !== "meaning").map((item) => item.key))
    .toEqual(expect.arrayContaining(["personal:p-coffee-1", "personal:p-coffee-2", "personal:p-cafe", "personal:p-lait", "personal:p-ramen"]));
  await expect
    .poll(async () =>
      (await timedSearch("alex", { query: "daily bank", pageSize: 50 })).items
        .filter((item) => item.match !== "meaning")
        .map((item) => item.key)
        .sort(),
    )
    .toEqual(["personal:p-coffee-1", "personal:p-rent", "personal:p-salary"]);
  // The old account name no longer matches by text (only meaning may still relate it).
  const old = await timedSearch("alex", { query: "everyday chequing", pageSize: 50 });
  expect(old.items.filter((item) => item.match === "title" || item.match === "text")).toEqual([]);
  // Bea's view never gains Alex's account or category names.
  const beaView = await timedSearch("bea", { query: "daily bank", pageSize: 50 });
  expect(beaView.items.filter((item) => item.match !== "meaning")).toEqual([]);

  const shown = await searchInBrowser(page, "eating out");
  // Titles come from the seed: "Café Crème" and "Café au lait" use precomposed and decomposed accents.
  const food = ["p-coffee-1", "p-coffee-2", "p-cafe", "p-lait", "p-ramen"].map((id) => titles.get(`personal:${id}`));
  expect([...shown.titles].sort()).toEqual(expect.arrayContaining([...food].sort()));
});

test("offline create, edit and delete search locally, then sync once on reconnect with no duplicates", async ({ browser, baseURL }) => {
  const page = await session("alex", baseURL, browser);
  const context = page.context();
  await page.goto("/transactions?month=2026-10");
  await expect(results(page).getByRole("status")).toHaveText(/matching transaction/);
  // Wait for the durable copy: the month's totals come from the downloaded ledger.
  await expect(page.getByRole("region", { name: "October 2026" })).toBeVisible();
  const before = await client("alex").read();

  await context.setOffline(true);
  // Create (pendingEdits.create): Coffee to go, 3.00 on Oct 14.
  await page.getByRole("button", { name: "Add entry" }).click();
  const add = page.getByRole("form", { name: "Add entry" });
  await add.getByLabel("Amount (CAD)").fill("3");
  await add.getByLabel("Title").fill("Coffee to go");
  await add.getByLabel("Date").fill("2026-10-14");
  await page.getByRole("dialog", { name: "Add entry" }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved on this device. It syncs when you're back online.")).toBeVisible();

  // Edit (pendingEdits.edit): the Oct 9 Coffee becomes Espresso.
  await results(page).locator('[data-row-key="personal:p-coffee-2"]').click();
  await page.getByRole("dialog", { name: "Coffee" }).getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("form", { name: "Edit entry" });
  await edit.getByLabel("Title").fill("Espresso");
  await page.getByRole("dialog", { name: "Edit entry" }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Delete (pendingEdits.delete): Café Crème.
  await results(page).locator('[data-row-key="personal:p-cafe"]').click();
  await page.getByRole("dialog", { name: titles.get("personal:p-cafe") }).getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog", { name: `Delete ${titles.get("personal:p-cafe") ?? ""}?` }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText(`${titles.get("personal:p-cafe") ?? ""} deleted`)).toBeVisible();

  // Local search over this browser's copy (pendingEdits.localSearch).
  const search = page.getByRole("searchbox", { name: "Search transactions" });
  await search.fill("coffee");
  await search.press("Enter");
  await expect(results(page).getByRole("status")).toHaveText(/on this device/);
  const personalCoffee = results(page).locator("[data-row-key] .results__title");
  await expect(personalCoffee).toHaveText(["Coffee to go", "Coffee"]);
  await search.fill("espresso");
  await search.press("Enter");
  await expect(personalCoffee).toHaveText(["Espresso"]);
  await search.fill("crème");
  await search.press("Enter");
  await expect(personalCoffee).toHaveCount(0);
  // Nothing reached the server while offline.
  expect((await client("alex").read()).revision).toBe(before.revision);

  await context.setOffline(false);
  await page.getByRole("button", { name: "Retry" }).click({ timeout: 5_000 }).catch(() => undefined);
  await expect.poll(async () => (await client("alex").read()).revision, { timeout: 20_000 }).toBeGreaterThan(before.revision);
  await expect(page.getByText(/change(s)? waiting/)).toHaveCount(0);

  const after = await client("alex").read();
  expect(after.ledger.transactions.filter((item) => item.title === "Coffee to go")).toHaveLength(1);
  expect(after.ledger.transactions.find((item) => item.id === "p-coffee-2")?.title).toBe("Espresso");
  expect(after.ledger.transactions.some((item) => item.id === "p-cafe")).toBe(false);

  const coffee = await timedSearch("alex", { query: "coffee", pageSize: 50 });
  const lexical = coffee.items.filter((item) => item.match !== "meaning");
  expect(lexical.filter((item) => item.entry.title === "Coffee to go")).toHaveLength(1);
  expect(lexical.map((item) => item.key)).not.toContain("personal:p-coffee-2");
  expect(coffee.items.map((item) => item.key)).not.toContain("personal:p-cafe");
  const shown = await searchInBrowser(page, "coffee");
  expect(shown.titles.filter((title) => title === "Coffee to go")).toHaveLength(1);
});

test("search latency stays inside the MAZ-121 budgets on this host", () => {
  expect(latencies.length).toBeGreaterThan(10);
  const sorted = latencies.map((item) => item.ms).sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
  const worst = sorted[sorted.length - 1] ?? 0;
  test.info().annotations.push({ type: "search latency", description: `${String(latencies.length)} requests, p95 ${p95.toFixed(1)} ms, max ${worst.toFixed(1)} ms` });
  // The documented warm budgets are 300 ms (selective) and 1 s (broad and counts), end to end over HTTP.
  expect(p95).toBeLessThan(300);
  expect(worst).toBeLessThan(1_000);
});
