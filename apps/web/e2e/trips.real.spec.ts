import { expect, test, type Browser, type Page } from "@playwright/test";

// The MAZ-93 two-person trip journey against the real .NET API and PostgreSQL from the
// full-stack test environment (docs/migration/test-environment.md). Skipped unless
// PENNY_REAL_STACK=1. It pins the server clock through the environment's test controls, so it
// never runs against a real server. In apps/web:
//
//   npm run build && npm run test:e2e:real -- trips.real --project=chromium-desktop
//
// Accounts are new random `.test` addresses; amounts are made up.
test.skip(process.env.PENNY_REAL_STACK !== "1", "needs the full-stack test environment (PENNY_REAL_STACK=1)");
test.describe.configure({ mode: "serial", timeout: 180_000 });

const PASSWORD = "correct horse battery";
const OCT_20 = "2026-10-20T15:00:00Z";

async function pinClock(iso: string | null) {
  const api = process.env.PENNY_API_URL;
  const token = process.env.PENNY_TEST_TOKEN;
  if (!api || !token) throw new Error("PENNY_API_URL and PENNY_TEST_TOKEN come from `npm run test-env -- run`.");
  const response = await fetch(`${api}/api/test/clock`, {
    method: iso ? "PUT" : "DELETE",
    headers: { "X-Penny-Test-Token": token, "Content-Type": "application/json" },
    ...(iso ? { body: JSON.stringify({ now: iso }) } : {}),
  });
  if (!response.ok) throw new Error(`clock: ${String(response.status)}`);
}

async function register(browser: Browser, baseURL: string | undefined, label: string) {
  const email = `${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@penny.test`;
  const context = await browser.newContext(baseURL ? { baseURL } : {});
  const page = await context.newPage();
  await page.clock.setFixedTime(OCT_20);
  const response = await page.request.post("/api/auth/register", { data: { email, password: PASSWORD } });
  expect(response.status()).toBe(201);
  return { email, context, page };
}

interface Snapshot {
  revision: number;
  ledger: { categories: { id: string; kind: string }[]; trips: { id: string; sharedHouseholdId?: string }[]; transactions: unknown[] } & Record<string, unknown>;
}

/** Alex planned Lisbon alone and paid the airport train before sharing (written as another device would). */
async function seedPersonalTrip(page: Page) {
  const snapshot = (await (await page.request.get("/api/ledger")).json()) as Snapshot;
  const category = snapshot.ledger.categories.find((item) => item.kind === "expense")?.id;
  expect(category).toBeTruthy();
  const write = await page.request.put("/api/ledger", {
    data: {
      revision: snapshot.revision,
      ledger: {
        ...snapshot.ledger,
        trips: [{ id: "lisbon-real", name: "Lisbon", startDate: "2026-11-12", endDate: "2026-11-19" }],
        transactions: [{ id: "train-real", title: "Airport train", kind: "expense", total: 2400, share: 2400, categoryId: category, date: "2026-09-28", note: "", tripId: "lisbon-real" }],
      },
    },
  });
  expect(write.ok()).toBe(true);
}

test.afterAll(async () => {
  await pinClock(null);
});

test("two people: share a personal trip, join after an expense, split, repay and refresh", async ({ browser, baseURL }) => {
  await pinClock(OCT_20);
  const alex = await register(browser, baseURL, "alex");
  const bea = await register(browser, baseURL, "bea");
  await seedPersonalTrip(alex.page);
  const seenByBea: string[] = [];
  bea.page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/api/")) {
      void response
        .text()
        .then((text) => seenByBea.push(text))
        .catch(() => undefined);
    }
  });

  // Alex shares the personal trip; the link is private ledger data, the train stays private.
  await alex.page.goto("/trips/lisbon-real");
  await expect(alex.page.getByRole("heading", { level: 1, name: "Lisbon" })).toBeVisible();
  await alex.page.getByRole("button", { name: "Share trip" }).click();
  await alex.page.getByRole("dialog", { name: "Share Lisbon?" }).getByRole("button", { name: "Share trip" }).click();
  await alex.page.getByRole("button", { name: "Create invite code" }).click();
  const code = (await alex.page.locator(".invite-code__value").innerText()).replace(/\s/g, "");
  expect(code).toMatch(/^[A-F0-9]{10}$/);
  const url = new URL(alex.page.url()).pathname;
  expect(url).toMatch(/^\/trips\/.+/);
  await expect
    .poll(async () => ((await (await alex.page.request.get("/api/ledger")).json()) as Snapshot).ledger.trips[0]?.sharedHouseholdId)
    .toBe(url.split("/").pop());

  // Flights before Bea joins: Alex's alone.
  await alex.page.goto(url);
  for (const [title, amount, date] of [["Flights", "824", "2026-10-02"]] as const) {
    await alex.page.getByRole("button", { name: "Trip expense" }).click();
    const form = alex.page.getByRole("dialog", { name: "New shared expense" });
    await form.getByLabel(/^Total/).fill(amount);
    await form.getByLabel("Title").fill(title);
    await form.getByLabel("Date").fill(date);
    await form.getByRole("button", { name: "Add expense" }).click();
    await expect(form).toBeHidden();
  }
  await expect(alex.page.getByRole("region", { name: "Only you" })).toContainText("Airport train");

  await bea.page.goto("/trips");
  await bea.page.getByRole("button", { name: "Join a trip" }).click();
  const join = bea.page.getByRole("dialog", { name: "Join a trip" });
  await join.getByLabel("Invite code").fill(code);
  await join.getByRole("button", { name: "Join trip" }).click();
  await expect(bea.page.getByRole("heading", { level: 1, name: "Lisbon" })).toBeVisible();
  const list = bea.page.getByRole("list", { name: "Expenses" });
  await expect(list.getByRole("link", { name: /Flights/ })).toContainText("Not part of your share");

  // After Bea joined: split with her. She refreshes and repays her share.
  await alex.page.getByRole("button", { name: "Trip expense" }).click();
  const form = alex.page.getByRole("dialog", { name: "New shared expense" });
  await form.getByLabel(/^Total/).fill("368");
  await form.getByLabel("Title").fill("Apartment");
  await form.getByLabel("Date").fill("2026-10-20");
  await form.getByRole("button", { name: "Add expense" }).click();
  await expect(form).toBeHidden();

  await bea.page.reload();
  await expect(list.getByRole("link", { name: /Apartment/ })).toContainText("$184.00 your share");
  await list.getByRole("link", { name: /Apartment/ }).click();
  await expect(bea.page).toHaveURL(/expense=/);
  const apartment = bea.page.getByRole("dialog", { name: "Apartment" });
  await apartment.getByRole("button", { name: "Mark your share as paid" }).click();
  await apartment.getByRole("button", { name: "Mark $184.00 as paid" }).click();
  await expect(apartment.getByText("Repaid", { exact: true })).toBeVisible();
  await bea.page.keyboard.press("Escape");
  await expect(bea.page).not.toHaveURL(/expense=/);

  // Back to the list and forward again keep the trip context.
  await bea.page.getByRole("link", { name: /All trips/ }).click();
  await expect(bea.page.getByRole("heading", { level: 1, name: "Trips" })).toBeVisible();
  await bea.page.goBack();
  await expect(bea.page.getByRole("heading", { level: 1, name: "Lisbon" })).toBeVisible();

  // Nothing Bea's browser received names Alex's private expense.
  expect(seenByBea.join("\n")).not.toContain("Airport train");

  await alex.context.close();
  await bea.context.close();
});
