import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createHouseholdServer, type HouseholdServer } from "../tests/fakes/householdServer.ts";

// Trips (MAZ-93) with two people in two browser contexts. /api is the in-memory household fake
// from tests/fakes (documented server rules and messages, plus a revision-checked private ledger
// per account), so personal trips go through the real durable offline store (IndexedDB) and sync
// with PUT /api/ledger, and shared trips through the shared-household API. trips.real.spec.ts
// runs the two-person journey against .NET and PostgreSQL. All names and amounts are synthetic.

const ALEX = "alex@example.test";
const BEA = "bea@example.test";
const OCT_20 = Date.parse("2026-10-20T15:00:00Z");

let server: HouseholdServer;

async function person(browser: Browser, email: string, baseURL: string | undefined): Promise<{ context: BrowserContext; page: Page }> {
  const { viewport, userAgent, isMobile, hasTouch, deviceScaleFactor } = test.info().project.use;
  const device = { ...(viewport ? { viewport } : {}), ...(userAgent ? { userAgent } : {}), ...(isMobile ? { isMobile } : {}), ...(hasTouch ? { hasTouch } : {}), ...(deviceScaleFactor ? { deviceScaleFactor } : {}) };
  const context = await browser.newContext({ ...device, ...(baseURL ? { baseURL } : {}) });
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/info") return route.fulfill({ json: { name: "penny", version: "2.0.0-e2e" } });
    if (url.pathname === "/api/auth/me") return route.fulfill({ json: { email } });
    if (url.pathname === "/api/auth/oidc") return route.fulfill({ json: { enabled: false } });
    if (url.pathname === "/api/v1/search/transactions") return route.fulfill({ json: { version: 1, items: [], totalCount: 0, nextCursor: null } });
    if (url.pathname === "/api/households/projection") return route.fulfill({ json: { transactions: [], scheduled: [] } });
    const body = request.postData() ? (JSON.parse(request.postData() ?? "{}") as Record<string, unknown>) : {};
    const result = server.handle(email, request.method(), `${url.pathname}${url.search}`, body);
    return route.fulfill({ status: result.status, json: result.body });
  });
  const page = await context.newPage();
  await page.clock.setFixedTime(OCT_20);
  return { context, page };
}

const horizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** A shared expense through the trip's own form (Trip expense). */
async function addTripExpense(page: Page, title: string, amount: string, date: string) {
  await page.getByRole("button", { name: "Trip expense" }).click();
  const form = page.getByRole("dialog", { name: "New shared expense" });
  await form.getByLabel(/^Total/).fill(amount);
  await form.getByLabel("Title").fill(title);
  await form.getByLabel("Date").fill(date);
  await form.getByRole("button", { name: "Add expense" }).click();
  await expect(form).toBeHidden();
}

test.beforeEach(() => {
  server = createHouseholdServer({ now: () => OCT_20 });
});

test("a shared personal trip keeps its earlier expense private, and a later member joins only later expenses", async ({ browser, baseURL }) => {
  // Alex already planned Lisbon alone and paid the airport train on another device.
  server.writeLedger(ALEX, (ledger) => ({
    ...ledger,
    trips: [{ id: "lisbon", name: "Lisbon", startDate: "2026-11-12", endDate: "2026-11-19" }],
    transactions: [{ id: "train", title: "Airport train", kind: "expense", total: 2400, share: 2400, categoryId: "c-groceries", date: "2026-09-28", note: "", tripId: "lisbon" }],
  }));
  const alex = await person(browser, ALEX, baseURL);
  const bea = await person(browser, BEA, baseURL);

  await alex.page.goto("/trips");
  await expect(alex.page.getByRole("heading", { level: 2, name: "Lisbon" })).toBeVisible();
  await expect(alex.page.getByText("In 23 days")).toBeVisible();
  await alex.page.getByRole("link", { name: "Open trip" }).click();
  await expect(alex.page.getByRole("heading", { level: 1, name: "Lisbon" })).toBeVisible();
  await expect(alex.page.getByText("1 outside the trip dates")).toBeVisible();

  await alex.page.getByRole("button", { name: "Share trip" }).click();
  const share = alex.page.getByRole("dialog", { name: "Share Lisbon?" });
  await expect(share.getByText("Your 1 expense stays private.")).toBeVisible();
  await share.getByRole("button", { name: "Share trip" }).click();
  await alex.page.getByRole("button", { name: "Create invite code" }).click();
  await expect(alex.page.getByText(/Expires in/)).toBeVisible();
  const code = server.state.invites[0]?.code ?? "";
  const tripId = server.state.households[0]?.id ?? "";
  await expect(alex.page).toHaveURL(new RegExp(`/trips/${tripId}\\?tab=people`));
  // The link to the shared trip reached the server's copy of Alex's ledger; the expense didn't move.
  await expect.poll(() => server.ledger(ALEX).ledger.trips[0]?.sharedHouseholdId).toBe(tripId);
  expect(server.state.expenses).toHaveLength(0);

  // Flights are booked before Bea joins: split among the people on the trip then (Alex).
  await alex.page.getByRole("link", { name: "Expenses" }).click();
  await addTripExpense(alex.page, "Flights", "824.00", "2026-10-02");
  await expect(alex.page.getByRole("region", { name: "Only you" }).getByText("Airport train")).toBeVisible();

  await bea.page.goto("/trips");
  await bea.page.getByRole("button", { name: "Join a trip" }).click();
  const join = bea.page.getByRole("dialog", { name: "Join a trip" });
  await join.getByLabel("Invite code").fill(code);
  await join.getByRole("button", { name: "Join trip" }).click();
  await expect(bea.page.getByRole("heading", { level: 1, name: "Lisbon" })).toBeVisible();
  await expect(bea.page).toHaveURL(new RegExp(`/trips/${tripId}$`));
  const flights = bea.page.getByRole("link", { name: /Flights/ });
  await expect(flights.getByText("Not part of your share")).toBeVisible();
  // Alex's private expense never reaches Bea.
  await expect(bea.page.getByText("Airport train")).toHaveCount(0);
  await expect(bea.page.getByRole("region", { name: "Only you" })).toHaveCount(0);

  // An expense after Bea joined is split with her; she sees it after a refresh.
  await addTripExpense(alex.page, "Apartment in Alfama", "368.00", "2026-11-12");
  await bea.page.reload();
  await expect(bea.page.getByRole("link", { name: /Apartment in Alfama/ }).getByText("$184.00 your share")).toBeVisible();

  // Balances settle by month: October (flights, Alex only) is settled, November isn't.
  await bea.page.getByRole("link", { name: "Balances" }).click();
  await expect(bea.page.getByText(/A trip settles month by month/)).toBeVisible();
  await bea.page.getByRole("link", { name: "Next month" }).click();
  await expect(bea.page).toHaveURL(/month=2026-11/);
  await bea.page.reload();
  await expect(bea.page.getByRole("navigation", { name: "Month" }).getByText("November 2026")).toBeVisible();

  // Alex's list shows Lisbon once, as the shared trip; the totals never add the private train to the group.
  await alex.page.goto("/trips");
  await expect(alex.page.getByRole("heading", { level: 2, name: "Lisbon" })).toHaveCount(1);
  await expect(alex.page.getByText("Trip total")).toBeVisible();
  await expect(alex.page.getByText("$1,192.00")).toBeVisible();
  // Alex's spending: all of the flights, half the apartment, and the private train.
  await expect(alex.page.getByText("$1,032.00")).toBeVisible();
  expect(await horizontalOverflow(alex.page)).toBeLessThanOrEqual(0);

  await alex.context.close();
  await bea.context.close();
});

test("personal trips by keyboard: assignment, deletion restrictions and a refresh", async ({ browser, baseURL }) => {
  const alex = await person(browser, ALEX, baseURL);
  const { page } = alex;
  await page.goto("/trips");
  await expect(page.getByRole("heading", { name: "Your next trip starts here" })).toBeVisible();
  await page.getByRole("button", { name: "New trip" }).first().click();
  const form = page.getByRole("dialog", { name: "New trip" });
  await expect(form.getByLabel("Trip name")).toBeFocused();
  await page.keyboard.type("Ski week");
  await form.getByLabel("Starts").fill("2027-02-14");
  await form.getByLabel("Ends").fill("2027-02-21");
  await form.getByLabel("Ends").press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Ski week" })).toBeVisible();
  const tripUrl = page.url();

  await page.getByRole("button", { name: "Trip expense" }).click();
  const add = page.getByRole("dialog", { name: "Add entry" });
  await expect(add.getByLabel("Trip")).toHaveValue(new URL(tripUrl).pathname.split("/").pop() ?? "");
  await add.getByLabel("Amount (CAD)").fill("640");
  await add.getByLabel("Title").fill("Lift pass");
  await add.getByRole("button", { name: "Save" }).click();
  await expect(add).toBeHidden();
  await expect(page.getByRole("list", { name: "Trip expenses" }).getByText("Lift pass")).toBeVisible();

  // Saved in the browser and synced: a refresh still shows the trip and its expense.
  await expect.poll(() => server.ledger(ALEX).ledger.transactions.length).toBe(1);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Ski week" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Trip expenses" }).getByText("Lift pass")).toBeVisible();

  // A trip with expenses can't be deleted; moving the expense off the trip allows it.
  await page.getByRole("button", { name: "Edit trip" }).click();
  const edit = page.getByRole("dialog", { name: "Edit trip" });
  await expect(edit.getByRole("button", { name: "Delete trip" })).toBeDisabled();
  await expect(edit.getByText(/1 expense is assigned to this trip/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(edit).toBeHidden();

  await page.getByRole("list", { name: "Trip expenses" }).getByRole("button", { name: /Lift pass/ }).click();
  await page.getByRole("dialog", { name: "Lift pass" }).getByRole("button", { name: "Edit" }).click();
  const entry = page.getByRole("dialog", { name: "Edit entry" });
  await entry.getByLabel("Trip").selectOption("");
  await entry.getByRole("button", { name: "Save" }).click();
  await expect(entry).toBeHidden();
  await expect(page.getByRole("heading", { name: "No expenses on this trip yet" })).toBeVisible();

  await page.getByRole("button", { name: "Edit trip" }).click();
  await edit.getByRole("button", { name: "Delete trip" }).click();
  await page.getByRole("dialog", { name: "Delete Ski week?" }).getByRole("button", { name: "Delete trip" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await expect.poll(() => server.ledger(ALEX).ledger.trips.length).toBe(0);
  // The expense stays, with no trip.
  expect(server.ledger(ALEX).ledger.transactions[0]?.tripId).toBeUndefined();
  await alex.context.close();
});

test("the demo shows its sample trip, says shared trips need a server and fits 320px", async ({ page }) => {
  await page.route("/api/info", (route) => route.fulfill({ json: { name: "penny", version: "2.0.0-e2e" } }));
  await page.route("/api/auth/me", (route) => route.fulfill({ status: 401, json: { error: "Please sign in to continue." } }));
  await page.route("/api/auth/oidc", (route) => route.fulfill({ json: { enabled: false } }));
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/trips");
  await page.getByRole("button", { name: "Explore a demo" }).click();
  await expect(page.getByText("You're exploring a demo")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Weekend in Québec City" })).toBeVisible();
  await expect(page.getByText("The demo has no shared trips.", { exact: false })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  await page.getByRole("link", { name: "Open trip" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Weekend in Québec City" })).toBeVisible();
  await expect(page.getByText("1 outside the trip dates")).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});
