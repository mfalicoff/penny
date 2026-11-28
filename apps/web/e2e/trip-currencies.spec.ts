import type { BrowserContext, Page } from "@playwright/test";
import { expect, motionOff, test } from "./test";

// Shared trips in any currency (MAZ-151 phase 2) in a real browser: the Lisbon trip in euros, seen
// by Max, whose home currency is CAD. Expenses were paid in euros, US dollars and Canadian dollars;
// the trip total and your share are in CAD, balances and suggested payments in euros, each
// person's own currency under their balance, and Settle in switches the currency at today's rate.
// A trip expense in another currency is converted at its date's rate and sent with what was paid.
// The new trip form has its currency. /api is mocked with the Lisbon numbers of
// contracts/fixtures/shared-currency.json (which reproduce the cards'); synthetic data only.
//
// PENNY_MAZ151_CAPTURES=<dir> also writes the cards' screens (light and dark) to <dir> for the
// design review (docs/design/visual-acceptance.md); without it those captures are skipped.

const EMAIL = "max@example.test";
const NOV_9 = Date.parse("2026-11-09T14:00:00Z");

const member = (userId: string, name: string, currency: string) => ({ userId, email: `${userId}@example.test`, joinedAt: 1_760_000_000_000, joinedOn: "2026-09-20", displayName: name, currency });
const MEMBERS = [
  { ...member("you", "Max Falicoff", "CAD"), email: EMAIL },
  member("sam", "Sam Kim", "USD"),
  member("jo", "Jo Silva", "EUR"),
  member("mira", "Mira Ito", "EUR"),
];
const HOUSEHOLD = { id: "lisbon", name: "Lisbon", currency: "EUR", creatorId: "you", createdAt: 1_760_000_000_000, memberCount: 4, trip: { startDate: "2026-11-12", endDate: "2026-11-19" } };

type Split = { userId: string; amountCents: number };
const equal = (cents: number, ids: string[]): Split[] => ids.map((userId) => ({ userId, amountCents: cents }));
const everyone = ["you", "sam", "jo", "mira"];

function expense(id: string, title: string, date: string, payer: string, totalCents: number, splits: Split[], category: { name: string; icon: string; color: string }, extra: Record<string, unknown>) {
  return {
    id, householdId: "lisbon", title, date, totalCents, payerUserId: payer, splitMode: "equal", category, note: "", splits,
    revision: 1, createdBy: payer, createdAt: 1_760_000_000_000, updatedBy: payer, updatedAt: 1_760_000_000_000, payments: [], paymentsClosed: false,
    ...extra,
  };
}

/** The card's four expenses: in euros (provisional today), Canadian dollars (yours: exact), euros, and US dollars. */
const EXPENSES = [
  expense("fado", "Fado tickets", "2026-11-09", "jo", 12000, equal(3000, everyone), { name: "Fun", icon: "musical-notes-outline", color: "#C77DBA" }, {
    home: { currency: "CAD", totalCents: 17556, shareCents: 4389, rate: "1.463", rateStatus: "provisional", rateDate: "2026-11-06" },
  }),
  expense("insurance", "Travel insurance", "2026-11-03", "mira", 1526, equal(763, ["you", "mira"]), { name: "Health", icon: "heart-outline", color: "#3E8E9E" }, {
    originalAmount: 2230, originalCurrency: "CAD", rate: "0.6843", rateStatus: "published", rateDate: "2026-11-03",
    home: { currency: "CAD", totalCents: 2230, shareCents: 1115 },
  }),
  expense("apartment", "Apartment in Alfama", "2026-10-08", "you", 25600, equal(6400, everyone), { name: "Home", icon: "home-outline", color: "#4F86E8" }, {
    home: { currency: "CAD", totalCents: 37325, shareCents: 9331, rate: "1.458", rateStatus: "published", rateDate: "2026-10-08" },
  }),
  expense("flights", "Flights", "2026-10-02", "sam", 56400, equal(14100, everyone), { name: "Transport", icon: "airplane-outline", color: "#678DB1" }, {
    originalAmount: 60000, originalCurrency: "USD", rate: "0.94", rateStatus: "published", rateDate: "2026-10-02",
    home: { currency: "CAD", totalCents: 82380, shareCents: 20595, rate: "1.373", rateStatus: "published", rateDate: "2026-10-02" },
  }),
];

/**
 * November's recap: the trip settles month by month, so its balances are November's (Fado
 * tickets and Travel insurance), not the whole trip's as on the cards.
 */
const NOVEMBER = {
  month: "2026-11",
  expenses: EXPENSES.filter((item) => item.date.startsWith("2026-11")),
  reimbursements: [],
  balances: [
    { userId: "jo", balanceCents: 9000 },
    { userId: "mira", balanceCents: -2237 },
    { userId: "sam", balanceCents: -3000 },
    { userId: "you", balanceCents: -3763 },
  ],
  suggestions: [
    { fromUserId: "you", toUserId: "jo", amountCents: 3763 },
    { fromUserId: "sam", toUserId: "jo", amountCents: 3000 },
    { fromUserId: "mira", toUserId: "jo", amountCents: 2237 },
  ],
  overdue: false,
  overdueMonths: [],
};

/**
 * Today's reference rates by base (the latest is Friday Nov 6's, so Monday's is provisional): how
 * many `base` units one unit of each currency is worth.
 */
const RATES: Record<string, Record<string, string>> = {
  CAD: { EUR: "1.463", USD: "1.3738", JPY: "0.008964" },
  EUR: { CAD: "0.6835", USD: "0.9406", JPY: "0.006127" },
  USD: { CAD: "0.7279", EUR: "1.0631", JPY: "0.006525" },
};

function ratesFor(base: string, date: string) {
  const provisional = date > "2026-11-06";
  return { enabled: true, source: "European Central Bank", base, date, rateDate: provisional ? "2026-11-06" : date, provisional, latestDate: "2026-11-06", rates: RATES[base] ?? {} };
}

const LEDGER = {
  version: 4,
  currency: "CAD",
  accounts: [{ id: "visa", name: "Visa", type: "credit" }],
  trips: [],
  categories: [
    { id: "fun", name: "Fun", icon: "musical-notes-outline", color: "#C77DBA", kind: "expense" },
    { id: "food", name: "Food & drinks", icon: "cafe-outline", color: "#E47850", kind: "expense" },
    { id: "transport", name: "Transport", icon: "bus-outline", color: "#678DB1", kind: "expense" },
  ],
  transactions: [],
  recurring: [],
};

interface Server {
  revision: number;
  ledger: Record<string, unknown> & { trips: Record<string, unknown>[] };
  posted: Record<string, unknown>[];
  createdTrips: Record<string, unknown>[];
}

async function mockApi(context: BrowserContext): Promise<Server> {
  const server: Server = { revision: 3, ledger: structuredClone(LEDGER), posted: [], createdTrips: [] };
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/api/info") return route.fulfill({ json: { name: "penny", version: "2.6.0-e2e" } });
    if (path === "/api/auth/me") return route.fulfill({ json: { email: EMAIL } });
    if (path === "/api/auth/oidc") return route.fulfill({ json: { enabled: false, providers: [] } });
    if (path === "/api/receipt-email") return route.fulfill({ json: { enabled: false, domain: null, address: null } });
    if (path === "/api/rates") return route.fulfill({ json: ratesFor(url.searchParams.get("base") ?? "CAD", url.searchParams.get("date") ?? "2026-11-09") });
    if (path === "/api/households") return route.fulfill({ json: { households: [HOUSEHOLD] } });
    if (path === "/api/households/projection") return route.fulfill({ json: { transactions: [], scheduled: [] } });
    if (path === "/api/households/trips" && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      server.createdTrips.push(body);
      return route.fulfill({ status: 201, json: { household: { ...HOUSEHOLD, id: "coast", name: body["name"], currency: body["currency"], memberCount: 1, trip: { startDate: body["startDate"], endDate: body["endDate"] } } } });
    }
    if (path === "/api/households/coast") return route.fulfill({ json: { household: { ...HOUSEHOLD, id: "coast", name: "Coast", memberCount: 1 }, members: [MEMBERS[0]] } });
    if (path === "/api/households/lisbon") return route.fulfill({ json: { household: HOUSEHOLD, members: MEMBERS } });
    if (/^\/api\/households\/(lisbon|coast)\/expenses$/.test(path)) {
      if (request.method() === "POST") {
        const body = request.postDataJSON() as Record<string, unknown>;
        server.posted.push(body);
        return route.fulfill({ status: 201, json: { expense: { ...EXPENSES[0], ...body, id: "new", splits: equal(Number(body["totalCents"]) / 4, everyone) } } });
      }
      return route.fulfill({ json: { expenses: path.includes("lisbon") ? EXPENSES : [] } });
    }
    if (/^\/api\/households\/(lisbon|coast)\/months\//.test(path)) return route.fulfill({ json: path.endsWith("2026-11") && path.includes("lisbon") ? NOVEMBER : { ...NOVEMBER, month: path.slice(-7), expenses: [], balances: [], suggestions: [] } });
    if (/^\/api\/households\/(lisbon|coast)\/recurring$/.test(path)) return route.fulfill({ json: { rules: [] } });
    if (/^\/api\/households\/(lisbon|coast)\/audit$/.test(path)) return route.fulfill({ json: { events: [] } });
    if (path === "/api/ledger") {
      if (request.method() === "PUT") {
        const body = request.postDataJSON() as { revision: number; ledger: Server["ledger"] };
        if (body.revision !== server.revision) return route.fulfill({ status: 409, json: { error: "The ledger changed.", code: "ledger.conflict" } });
        server.revision += 1;
        server.ledger = body.ledger;
      }
      return route.fulfill({ json: { revision: server.revision, ledger: server.ledger } });
    }
    if (path === "/api/v1/search/transactions") return route.fulfill({ json: { version: 1, items: [], totalCount: 0, nextCursor: null } });
    return route.fulfill({ status: 404, json: { error: "API route not found." } });
  });
  return server;
}

async function open(page: Page, path: string) {
  await page.clock.setFixedTime(NOV_9);
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test("a euro trip shows your totals in CAD, what each expense was paid in, and balances in euros", async ({ context, page, isMobile }) => {
  await mockApi(context);
  await open(page, "/trips/lisbon");
  // The trip total and your share are summed from your home amounts: the cards' $1,394.91 and $354.30.
  await expect(page.getByText("$1,394.91").first()).toBeVisible();
  await expect(page.getByText("$354.30").first()).toBeVisible();
  await expect(page.getByText(/EUR, USD and CAD · each at its date's rate/)).toBeVisible();

  if (!isMobile && (page.viewportSize()?.width ?? 0) >= 1100) {
    const table = page.getByRole("region", { name: "Shared with everyone" });
    const row = (title: string) => table.getByRole("row").filter({ hasText: title });
    await expect(page.getByText("EUR, USD and CAD · each at its date's rate · in your currency, CAD")).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "In CAD" })).toBeVisible();
    await expect(row("Fado tickets")).toContainText("€120.00");
    await expect(row("Fado tickets")).toContainText("$175.56");
    await expect(row("Fado tickets")).toContainText("provisional");
    await expect(row("Fado tickets")).toContainText("Today");
    await expect(row("Travel insurance")).toContainText("$22.30");
    await expect(row("Travel insurance")).toContainText("Paid in CAD");
    await expect(row("Flights")).toContainText("US$600.00");
    await expect(row("Flights")).toContainText("$823.80");
    await expect(row("Flights")).toContainText("$205.95");

    // Balances in euros, each person's own currency under it at today's rate.
    const summary = page.getByRole("region", { name: "Trip summary" });
    await expect(summary.getByRole("heading", { name: "Balances in euros" })).toBeVisible();
    const balances = summary.getByRole("list", { name: "Balances for November 2026" });
    await expect(balances.getByRole("listitem").filter({ hasText: "Jo Silva" })).toContainText("+€90.00");
    await expect(balances.getByRole("listitem").filter({ hasText: "Jo Silva" })).toContainText("gets back");
    await expect(balances.getByRole("listitem").filter({ hasText: "Sam Kim" })).toContainText("≈ −US$31.89");
    await expect(balances.getByRole("listitem").filter({ hasText: "You" })).toContainText("≈ −$55.05");
    const suggestions = page.getByRole("region", { name: "Suggested payments" });
    await expect(suggestions).toContainText("in euros");
    await expect(suggestions).toContainText("€37.63");
    await expect(suggestions).toContainText("Each expense counts in euros at its own date's rate, so balances don't move later.");

    // Settle in CAD: today's rate, display only.
    await summary.getByRole("button", { name: /^Settle in EUR/ }).click();
    await summary.getByRole("button", { name: /^CAD/ }).click();
    await expect(summary.getByRole("heading", { name: "Balances in Canadian dollars" })).toBeVisible();
    await expect(balances.getByRole("listitem").filter({ hasText: "Jo Silva" })).toContainText("+$131.67");
    await expect(suggestions).toContainText("$55.05");
    await expect(suggestions).toContainText("Record paid records euros.");
  } else {
    const rows = page.getByRole("list", { name: "Shared expenses" });
    await expect(rows.getByRole("link", { name: /Fado tickets/ })).toContainText("€120.00");
    await expect(rows.getByRole("link", { name: /Fado tickets/ })).toContainText("≈ $175.56");
    await expect(rows.getByRole("link", { name: /Apartment in Alfama/ })).toContainText("$373.25");
    await expect(rows.getByRole("link", { name: /Travel insurance/ })).not.toContainText("$22.30 $");

    await page.getByRole("navigation", { name: "Trip sections" }).getByRole("link", { name: "Balances" }).click();
    await expect(page.getByRole("heading", { name: "Balances in euros" })).toBeVisible();
    const balances = page.getByRole("list", { name: "Balances for November 2026" });
    await expect(balances.getByRole("listitem").filter({ hasText: "Sam Kim" })).toContainText("≈ −US$31.89");
    await expect(page.getByText(/Each expense counts in euros at its own date's rate/)).toBeVisible();
  }
});

test("a trip expense in US dollars is converted to euros at its date's rate and sent with what was paid", async ({ context, page }) => {
  const server = await mockApi(context);
  await open(page, "/trips/lisbon?add=1");
  const form = page.getByRole("form", { name: "New expense" });
  await expect(form).toBeVisible();
  // New trip expenses start in the trip's currency.
  const chip = form.getByRole("button", { name: /^Currency: EUR/ });
  await expect(chip).toBeVisible();
  await chip.click();
  const menu = form.getByRole("dialog", { name: "Currency" });
  await expect(menu.getByRole("region", { name: "Suggested" }).getByRole("button", { name: "EUR, Euro, Lisbon's currency" })).toBeVisible();
  await expect(menu.getByRole("region", { name: "Suggested" }).getByRole("button", { name: "CAD, Canadian dollar, Home" })).toBeVisible();
  await menu.getByRole("searchbox", { name: "Search currencies" }).fill("USD");
  await menu.getByRole("searchbox", { name: "Search currencies" }).press("Enter");
  await form.getByLabel("Amount (USD)").fill("40.00");
  await form.getByLabel("Title").fill("Tram passes");
  await expect(form.getByText("≈ €37.62 EUR")).toBeVisible();
  await expect(form.getByText("1 USD = 0.9406 EUR")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect.poll(() => server.posted.length).toBe(1);
  expect(server.posted[0]).toMatchObject({ title: "Tram passes", totalCents: 3762, originalAmount: 4000, originalCurrency: "USD", rate: "0.9406", rateStatus: "provisional", rateDate: "2026-11-06" });
});

test("a new shared trip sends its currency", async ({ context, page }) => {
  const server = await mockApi(context);
  await open(page, "/trips");
  await page.getByRole("button", { name: "New trip" }).first().click();
  const form = page.getByRole("dialog", { name: "New trip" });
  await form.getByLabel("Trip name").fill("Coast");
  await form.getByRole("button", { name: /^Currency: CAD/ }).click();
  await form.getByRole("searchbox", { name: "Search currencies" }).fill("EUR");
  await form.getByRole("searchbox", { name: "Search currencies" }).press("Enter");
  await expect(form.getByText(/New trip expenses start in euros\. Any expense can use another currency\./)).toBeVisible();
  await form.getByRole("switch", { name: "Share with others" }).check();
  await expect(form.getByText(/New trip expenses start in euros, and payments are suggested in euros\./)).toBeVisible();
  await form.getByRole("button", { name: "Create trip" }).click();
  await expect.poll(() => server.createdTrips[0]?.["currency"]).toBe("EUR");
});

test("a new personal trip keeps its currency in the ledger", async ({ context, page }) => {
  const server = await mockApi(context);
  await open(page, "/trips");
  await page.getByRole("button", { name: "New trip" }).first().click();
  const form = page.getByRole("dialog", { name: "New trip" });
  await form.getByLabel("Trip name").fill("Kyoto");
  await form.getByRole("button", { name: /^Currency: CAD/ }).click();
  await form.getByRole("searchbox", { name: "Search currencies" }).fill("JPY");
  await form.getByRole("searchbox", { name: "Search currencies" }).press("Enter");
  await form.getByRole("button", { name: "Create trip" }).click();
  await expect.poll(() => server.ledger.trips.find((trip) => trip["name"] === "Kyoto")?.["currency"]).toBe("JPY");
});

// ---------- card captures for the design review (PENNY_MAZ151_CAPTURES) ----------

const captures = process.env.PENNY_MAZ151_CAPTURES;

async function capture(page: Page, name: string, scheme: "light" | "dark") {
  await page.waitForTimeout(800);
  await motionOff(page);
  await page.mouse.move(1, 1);
  await page.screenshot({ path: `${captures ?? ""}/${name}.${scheme}.png` });
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`trip currency card captures (${scheme})`, () => {
    test.skip(!captures, "Set PENNY_MAZ151_CAPTURES to a directory to capture the cards.");
    test.use({ colorScheme: scheme });

    test("web cards", async ({ context, page, isMobile }) => {
      test.skip(isMobile, "web-* cards are desktop captures.");
      await page.setViewportSize({ width: 1440, height: 900 });
      await mockApi(context);
      await open(page, "/trips/lisbon");
      await expect(page.getByText("$1,394.91").first()).toBeVisible();
      await expect(page.getByText("+€90.00")).toBeVisible();
      await capture(page, "web-trip-currencies", scheme);

      await page.goto("/trips");
      await page.getByRole("button", { name: "New trip" }).first().click();
      const form = page.getByRole("dialog", { name: "New trip" });
      await form.getByLabel("Trip name").fill("Lisbon");
      await form.getByLabel("Starts").fill("2026-11-12");
      await form.getByLabel("Ends").fill("2026-11-19");
      await form.getByRole("button", { name: /^Currency: CAD/ }).click();
      await form.getByRole("searchbox", { name: "Search currencies" }).fill("EUR");
      await form.getByRole("searchbox", { name: "Search currencies" }).press("Enter");
      await form.getByRole("switch", { name: "Share with others" }).check();
      await form.getByLabel("Trip name").focus();
      await capture(page, "web-trip-form-currency", scheme);
    });

    test("iPhone cards at 402px", async ({ context, page, isMobile }) => {
      test.skip(isMobile, "Captured at the cards' 402px in the desktop browser, as cards.real.spec.ts does.");
      await page.setViewportSize({ width: 402, height: 874 });
      await mockApi(context);
      await open(page, "/trips/lisbon");
      await expect(page.getByText("$1,394.91").first()).toBeVisible();
      await capture(page, "iphone-trip-currencies", scheme);

      await page.goto("/trips/lisbon?tab=balances");
      await expect(page.getByRole("heading", { name: "Balances in euros" })).toBeVisible();
      await capture(page, "iphone-trip-balances-currency", scheme);

      await page.goto("/trips");
      await page.getByRole("button", { name: "New trip" }).first().click();
      const form = page.getByRole("dialog", { name: "New trip" });
      await form.getByLabel("Trip name").fill("Lisbon");
      await form.getByLabel("Starts").fill("2026-11-12");
      await form.getByLabel("Ends").fill("2026-11-19");
      await form.getByRole("button", { name: /^Currency: CAD/ }).click();
      await form.getByRole("searchbox", { name: "Search currencies" }).fill("EUR");
      await form.getByRole("searchbox", { name: "Search currencies" }).press("Enter");
      await form.getByRole("switch", { name: "Share with others" }).check();
      await form.getByLabel("Trip name").focus();
      await capture(page, "iphone-trip-form-currency", scheme);
    });
  });
}
