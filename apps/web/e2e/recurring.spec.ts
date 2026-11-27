import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./test";

// Recurring schedules (MAZ-90) in real Chromium over the durable offline store (IndexedDB): every
// frequency, anchor days in short months, detail actions with focus recovery, offline saves with a
// reload and one PUT on reconnect, and a schedule deleted on another device that must not come back
// after this browser caught it up offline. /api is mocked with a revision-checked ledger; the real
// .NET/PostgreSQL journeys are MAZ-95. Synthetic data only.

const EMAIL = "alex@example.test";
interface Rule {
  id: string;
  title: string;
  kind: string;
  total: number;
  share: number;
  categoryId: string;
  date: string;
  note: string;
  frequency: string;
  nextDate: string;
  anchorDay: number;
  active: boolean;
  accountId?: string;
}
interface Entry {
  id: string;
  title: string;
  date: string;
  recurringId?: string;
}
const emptyLedger = () => ({
  version: 4,
  currency: "CAD",
  accounts: [{ id: "visa", name: "Visa", type: "credit" }],
  trips: [] as unknown[],
  categories: [
    { id: "home", name: "Home", icon: "home-outline", color: "#C6953A", kind: "expense" },
    { id: "salary", name: "Salary", icon: "briefcase-outline", color: "#6C9C79", kind: "income" },
    { id: "investments", name: "Investments", icon: "trending-up-outline", color: "#678DB1", kind: "investment" },
  ],
  transactions: [] as Entry[],
  recurring: [] as Rule[],
});
type Ledger = ReturnType<typeof emptyLedger>;

interface Server {
  revision: number;
  ledger: Ledger;
  down: boolean;
  puts: number;
}

/** `/api/households…` responses by path, for shared schedules (MAZ-177). */
type Shared = Record<string, unknown>;

async function mockApi(context: BrowserContext, ledger: Ledger = emptyLedger(), shared: Shared = {}): Promise<Server> {
  const server: Server = { revision: 3, ledger, down: false, puts: 0 };
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/info") return route.fulfill({ json: { name: "penny", version: "2.0.0-e2e" } });
    if (path === "/api/auth/me") return route.fulfill({ json: { email: EMAIL } });
    if (path === "/api/receipt-email") return route.fulfill({ json: { enabled: false, domain: null, address: null } });
    if (path === "/api/auth/oidc") return route.fulfill({ json: { enabled: false, providers: [] } });
    if (path in shared) return route.fulfill({ json: shared[path] });
    if (path === "/api/v1/search/transactions") return route.fulfill({ json: { version: 1, items: [], totalCount: 0, nextCursor: null } });
    if (path === "/api/ledger") {
      if (server.down) return route.abort("connectionrefused");
      if (request.method() === "PUT") {
        const body = request.postDataJSON() as { revision: number; ledger: Ledger };
        if (body.revision !== server.revision) return route.fulfill({ status: 409, json: { error: "The ledger changed." } });
        server.puts += 1;
        server.revision += 1;
        server.ledger = body.ledger;
      }
      return route.fulfill({ json: { revision: server.revision, ledger: server.ledger } });
    }
    return route.fulfill({ status: 404, json: { error: "API route not found." } });
  });
  return server;
}

const synced = (page: Page) => expect(page.getByText(/changes? waiting/)).toHaveCount(0);

async function addSchedule(page: Page, values: { kind?: string; amount: string; name: string; frequency: string; date: string }) {
  await page.getByRole("button", { name: "New schedule" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New schedule" });
  if (values.kind) await dialog.getByRole("radio", { name: values.kind }).check();
  await dialog.getByLabel("Amount (CAD)").fill(values.amount);
  await dialog.getByLabel("Name").fill(values.name);
  await dialog.getByRole("radio", { name: values.frequency }).check();
  await dialog.getByLabel("First date").fill(values.date);
  return dialog;
}

test("creates every frequency, follows anchor days through short months, edits, pauses, resumes and removes", async ({ context, page }) => {
  const server = await mockApi(context);
  await page.clock.setFixedTime(new Date("2026-11-10T12:00:00"));
  await page.goto("/recurring");
  await expect(page.getByRole("heading", { name: "No schedules yet" })).toBeVisible();

  // Monthly on the 31st: November and February fall back to their last day.
  let dialog = await addSchedule(page, { amount: "1450", name: "Rent", frequency: "Monthly", date: "2026-12-31" });
  await expect(dialog.getByRole("status")).toContainText("First on Dec 31, then monthly on the 31st. In months without a 31st, it uses the last day.");
  await dialog.getByRole("button", { name: "Add schedule" }).click();
  await expect(page.getByText("Rent added")).toBeVisible();

  // Yearly on a leap day, weekly income, and a backdated monthly investment that catches up once.
  dialog = await addSchedule(page, { amount: "120", name: "Domain renewal", frequency: "Yearly", date: "2028-02-29" });
  await expect(dialog.getByRole("status")).toContainText("First on Feb 29, 2028, then yearly on Feb 29.");
  await dialog.getByRole("button", { name: "Add schedule" }).click();
  dialog = await addSchedule(page, { kind: "Income", amount: "1125", name: "Payday", frequency: "Weekly", date: "2026-11-13" });
  await dialog.getByRole("button", { name: "Add schedule" }).click();
  dialog = await addSchedule(page, { kind: "Investment", amount: "200", name: "TFSA contribution", frequency: "Monthly", date: "2026-10-06" });
  await expect(dialog.getByRole("status")).toContainText("Saving records 2 entries");
  await dialog.getByRole("button", { name: "Add schedule" }).click();
  await synced(page);

  await expect(page.getByRole("list", { name: "Income schedules" })).toContainText("Weekly · next Nov 13");
  await expect(page.getByRole("list", { name: "Investment schedules" })).toContainText("next Dec 6");
  await expect.poll(() => server.ledger.transactions.map((entry) => entry.date).sort()).toEqual(["2026-10-06", "2026-11-06"]);

  // Detail from the row, then Edit: the amount changes, the anchor stays on the 31st.
  await page.getByRole("button", { name: /^Rent/ }).click();
  dialog = page.getByRole("dialog", { name: "Rent" });
  await expect(dialog).toContainText("Every month on the 31st");
  await expect(dialog.getByRole("list")).toContainText(/Thu, Dec 31.*Sun, Jan 31, 2027.*Sun, Feb 28, 2027/);
  await dialog.getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: "Edit schedule" });
  await edit.getByLabel("Amount (CAD)").fill("1500");
  await edit.getByLabel("Account").selectOption({ label: "Visa" });
  await edit.getByRole("button", { name: "Save changes" }).click();
  dialog = page.getByRole("dialog", { name: "Rent" });
  await expect(dialog).toContainText("$1,500.00");
  await expect(dialog).toContainText("Visa");

  // Pause and resume are separate from Edit, and pausing records nothing.
  await dialog.getByRole("button", { name: "Pause" }).click();
  await expect(dialog).toContainText("Paused: Penny records nothing");
  await dialog.getByRole("button", { name: "Resume" }).click();
  await expect(dialog.getByRole("button", { name: "Pause" })).toBeVisible();
  await synced(page);
  await expect.poll(() => server.ledger.recurring.find((rule) => rule.title === "Rent")).toMatchObject({ total: 150000, anchorDay: 31, nextDate: "2026-12-31", active: true, accountId: "visa" });

  // Remove asks first, keeps recorded entries, and focus lands on New schedule.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^TFSA contribution/ }).click();
  await page.getByRole("dialog", { name: "TFSA contribution" }).getByRole("button", { name: "Remove schedule" }).click();
  const confirm = page.getByRole("dialog", { name: "Remove TFSA contribution?" });
  await expect(confirm).toContainText("Entries it already recorded stay in your activity");
  await confirm.getByRole("button", { name: "Remove schedule" }).click();
  await expect(page.getByRole("button", { name: "New schedule" }).first()).toBeFocused();
  await synced(page);
  await expect.poll(() => server.ledger.recurring.map((rule) => rule.title).sort()).toEqual(["Domain renewal", "Payday", "Rent"]);
  expect(server.ledger.transactions).toHaveLength(2);

  // No horizontal scrolling at this width.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test("keeps a schedule saved offline through a reload and syncs it once, without duplicate entries", async ({ context, page }) => {
  const server = await mockApi(context);
  await page.clock.setFixedTime(new Date("2026-11-10T12:00:00"));
  await page.goto("/recurring");
  await expect(page.getByRole("heading", { name: "No schedules yet" })).toBeVisible();
  server.down = true;

  const dialog = await addSchedule(page, { amount: "65", name: "Internet", frequency: "Monthly", date: "2026-11-10" });
  await dialog.getByRole("button", { name: "Add schedule" }).click();
  await expect(page.getByRole("button", { name: /^Internet/ })).toContainText("Waiting to sync");

  await page.reload();
  await expect(page.getByRole("button", { name: /^Internet/ })).toContainText("Waiting to sync");
  await expect(page.getByText("Offline · 2 changes waiting")).toBeVisible();

  server.down = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await synced(page);
  expect(server.puts).toBe(1);
  await expect.poll(() => server.ledger.transactions.map((entry) => entry.date)).toEqual(["2026-11-10"]);
  expect(server.puts).toBe(1);

  await page.reload();
  await expect(page.getByRole("button", { name: /^Internet/ })).toContainText("next Dec 10");
  await synced(page);
  expect(server.puts).toBe(1);
  expect(server.ledger.transactions).toHaveLength(1);
});

test("doesn't bring back a schedule deleted on another device after an offline catch-up", async ({ context, page }) => {
  const ledger = emptyLedger();
  ledger.recurring = [
    { id: "pass", title: "Transit pass", kind: "expense", total: 6200, share: 6200, categoryId: "home", date: "2026-10-01", note: "", frequency: "monthly", nextDate: "2026-11-01", anchorDay: 1, active: true },
  ];
  const server = await mockApi(context, ledger);

  // Oct 31: synced, nothing due yet.
  await page.clock.setFixedTime(new Date("2026-10-31T12:00:00"));
  await page.goto("/recurring");
  await expect(page.getByRole("button", { name: /^Transit pass/ })).toContainText("next Nov 1");
  await synced(page);

  // Nov 10 with the server unreachable: the reload records Nov 1 on this device only.
  server.down = true;
  await page.clock.setFixedTime(new Date("2026-11-10T12:00:00"));
  await page.reload();
  await expect(page.getByRole("button", { name: /^Transit pass/ })).toContainText("next Dec 1");
  await expect(page.getByText("Offline · 2 changes waiting")).toBeVisible();

  // Meanwhile the phone deletes the schedule.
  server.ledger = { ...server.ledger, recurring: [] };
  server.revision += 1;

  server.down = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("heading", { name: "No schedules yet" })).toBeVisible();
  await synced(page);
  await expect.poll(() => server.ledger.recurring).toEqual([]);
  expect(server.ledger.transactions).toEqual([]);

  // It stays gone after another reload.
  await page.reload();
  await expect(page.getByRole("heading", { name: "No schedules yet" })).toBeVisible();
  expect(server.ledger.recurring).toEqual([]);
});

test("keeps each row's title left and amount right from 320px, with shared schedules listed (MAZ-177)", async ({ context, page }) => {
  const ledger = emptyLedger();
  ledger.recurring = [
    { id: "net", title: "Internet and home phone bundle", kind: "expense", total: 6500, share: 6500, categoryId: "home", date: "2026-03-18", note: "", frequency: "monthly", nextDate: "2026-11-18", anchorDay: 18, active: true, accountId: "visa" },
    { id: "gym", title: "Gym", kind: "expense", total: 4500, share: 4500, categoryId: "home", date: "2026-03-01", note: "", frequency: "monthly", nextDate: "2026-12-01", anchorDay: 1, active: false },
  ];
  const joinedAt = Date.UTC(2026, 0, 5, 12);
  const household = { id: "h1", name: "Maison", currency: "CAD", creatorId: "u-alex", createdAt: joinedAt, memberCount: 2 };
  await mockApi(context, ledger, {
    "/api/households": { households: [household] },
    "/api/households/h1": {
      household,
      members: [
        { userId: "u-alex", email: EMAIL, joinedAt, joinedOn: "2026-01-05" },
        { userId: "u-bea", email: "bea@example.test", joinedAt, joinedOn: "2026-01-05" },
      ],
    },
    "/api/households/h1/recurring": {
      rules: [
        { id: "s1", householdId: "h1", title: "Streaming", totalCents: 1600, payerUserId: "u-bea", splitMode: "equal", category: { name: "Fun", icon: "film-outline", color: "#5E5CE6" }, note: "", nextDate: "2026-11-20", frequency: "monthly", anchorDay: 20, active: true, revision: 1 },
      ],
    },
  });
  await page.clock.setFixedTime(new Date("2026-11-10T12:00:00"));
  for (const width of [320, 402]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/recurring");
    const shared = page.getByRole("link", { name: /^Streaming/ });
    // The Shared tag beside the title, the household on its own line, your share under the amount (MAZ-232).
    await expect(shared).toContainText(/^Streaming Shared\s*Monthly · next Nov 20Maison(Maison)?−\$8\.00your share/);
    for (const row of [page.getByRole("button", { name: /^Internet/ }), page.getByRole("button", { name: /^Gym/ }), shared]) {
      const box = await row.boundingBox();
      const title = await row.locator(".schedule-row__title").boundingBox();
      const amount = await row.locator(".schedule-row__end .money").boundingBox();
      if (!box || !title || !amount) throw new Error("row not laid out");
      // The title starts at the left, next to the tile; the amount ends at the right, before the
      // chevron, in its own column beside the title (not on a line of its own), and starts within
      // the title's lines.
      expect(title.x - box.x).toBeLessThanOrEqual(64);
      expect(box.x + box.width - (amount.x + amount.width)).toBeLessThan(48);
      expect(amount.x).toBeGreaterThanOrEqual(title.x + title.width);
      expect(amount.y).toBeLessThan(title.y + title.height);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  }
});

test("suggests repeating entries: accepting saves one schedule without duplicate entries, a dismissal has Undo and survives a reload (MAZ-290)", async ({ context, page }) => {
  const entry = (id: string, title: string, kind: string, share: number, date: string, categoryId: string) => ({ id, title, kind, total: share, share, categoryId, accountId: "visa", date, note: "" });
  const ledger = emptyLedger();
  ledger.transactions = [
    entry("n1", "Netflix", "expense", 1549, "2026-08-03", "home"),
    entry("n2", "Netflix", "expense", 1549, "2026-09-03", "home"),
    entry("n3", "Netflix", "expense", 1699, "2026-10-03", "home"),
    entry("n4", "Netflix", "expense", 1699, "2026-11-03", "home"),
    ...["2026-10-07", "2026-10-14", "2026-10-21", "2026-10-28", "2026-11-04"].map((date, index) => entry(`t${String(index)}`, "Tutoring", "income", 6000, date, "salary")),
  ];
  const server = await mockApi(context, ledger);
  await page.clock.setFixedTime(new Date("2026-11-10T12:00:00"));
  await page.goto("/recurring");
  const suggested = page.getByRole("list", { name: "Suggested schedules" });
  const netflix = suggested.getByRole("listitem").filter({ hasText: /^Netflix/ });
  const tutoring = suggested.getByRole("listitem").filter({ hasText: /^Tutoring/ });
  await expect(netflix).toContainText("Every month, around the 3rd");
  await expect(netflix).toContainText("Seen 4 times since Aug 3");
  await expect(netflix).toContainText("was $15.49");
  await expect(tutoring).toContainText("Every week, on Wednesdays");
  await synced(page);
  const before = server.puts;

  // Dismiss acts at once; Undo brings it back.
  await netflix.getByRole("button", { name: "Dismiss" }).click();
  await expect(netflix).toHaveCount(0);
  await expect(tutoring.getByRole("button", { name: "Make it a schedule" })).toBeFocused();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(netflix).toHaveCount(1);
  await expect(netflix.getByRole("button", { name: "Make it a schedule" })).toBeFocused();

  // Dismissed again, the dismissal syncs and stays through a reload.
  await page.mouse.move(0, 0);
  await netflix.getByRole("button", { name: "Dismiss" }).click();
  await expect(netflix).toHaveCount(0);
  await synced(page);
  await expect.poll(() => (server.ledger as Ledger & { dismissedSuggestions?: string[] }).dismissedSuggestions).toEqual(["expense|netflix|monthly|1699"]);
  expect(server.puts).toBeGreaterThan(before);
  await page.reload();
  await expect(tutoring).toHaveCount(1);
  await expect(netflix).toHaveCount(0);

  // Make it a schedule: the form is filled in, with the matched entries; saving adds one schedule and no entry.
  await tutoring.getByRole("button", { name: "Make it a schedule" }).click();
  const dialog = page.getByRole("dialog", { name: "New schedule" });
  await expect(dialog).toContainText("Filled in from 5 Tutoring entries. Check it, then add it.");
  await expect(dialog.getByLabel("First date")).toHaveValue("2026-11-11");
  await expect(dialog.getByRole("region", { name: /^Already in your activity/ }).getByRole("listitem")).toHaveCount(5);
  await dialog.getByRole("button", { name: "Add schedule" }).click();
  await expect(page.getByText("Tutoring added")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Tutoring.*next Nov 11/ })).toBeFocused();
  await expect(page.getByRole("heading", { name: "No schedules yet" })).toHaveCount(0);
  await expect(suggested).toHaveCount(0);
  await synced(page);
  await expect.poll(() => server.ledger.recurring.map((rule) => [rule.title, rule.frequency, rule.nextDate, rule.share])).toEqual([["Tutoring", "weekly", "2026-11-11", 6000]]);
  expect(server.ledger.transactions).toHaveLength(9);

  // A reload records nothing twice and suggests nothing new.
  await page.reload();
  await expect(page.getByRole("button", { name: /^Tutoring/ })).toBeVisible();
  await synced(page);
  expect(server.ledger.transactions).toHaveLength(9);
  await expect(suggested).toHaveCount(0);
});
