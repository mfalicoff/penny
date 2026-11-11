import { expect, test, type BrowserContext, type Page } from "@playwright/test";

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

async function mockApi(context: BrowserContext, ledger: Ledger = emptyLedger()): Promise<Server> {
  const server: Server = { revision: 3, ledger, down: false, puts: 0 };
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/info") return route.fulfill({ json: { name: "penny", version: "2.0.0-e2e" } });
    if (path === "/api/auth/me") return route.fulfill({ json: { email: EMAIL } });
    if (path === "/api/auth/oidc") return route.fulfill({ json: { enabled: false } });
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
  await page.getByRole("button", { name: "New schedule" }).click();
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
  await expect(page.getByRole("heading", { name: "Rent, payday, the usuals." })).toBeVisible();

  // Monthly on the 31st: November and February fall back to their last day.
  let dialog = await addSchedule(page, { amount: "1450", name: "Rent", frequency: "Monthly", date: "2026-12-31" });
  await expect(dialog.getByRole("status")).toContainText("First on Thu, Dec 31, 2026, then Sun, Jan 31, 2027, then Sun, Feb 28. In months without a 31st, it uses the last day.");
  await dialog.getByRole("button", { name: "Add schedule" }).click();
  await expect(page.getByText("Rent added")).toBeVisible();

  // Yearly on a leap day, weekly income, and a backdated monthly investment that catches up once.
  dialog = await addSchedule(page, { amount: "120", name: "Domain renewal", frequency: "Yearly", date: "2028-02-29" });
  await expect(dialog.getByRole("status")).toContainText("Tue, Feb 29, 2028, then Wed, Feb 28, 2029, then Thu, Feb 28, 2030");
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
  await expect(page.getByRole("button", { name: "New schedule" })).toBeFocused();
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
  await expect(page.getByRole("heading", { name: "Rent, payday, the usuals." })).toBeVisible();
  server.down = true;

  const dialog = await addSchedule(page, { amount: "65", name: "Internet", frequency: "Monthly", date: "2026-11-10" });
  await dialog.getByRole("button", { name: "Add schedule" }).click();
  await expect(page.getByRole("button", { name: /^Internet/ })).toContainText("Waiting to sync");

  await page.reload();
  await expect(page.getByRole("button", { name: /^Internet/ })).toContainText("Waiting to sync");
  await expect(page.getByText("Not synced · 2 changes waiting")).toBeVisible();

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
  await expect(page.getByText("Not synced · 2 changes waiting")).toBeVisible();

  // Meanwhile the phone deletes the schedule.
  server.ledger = { ...server.ledger, recurring: [] };
  server.revision += 1;

  server.down = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("heading", { name: "Rent, payday, the usuals." })).toBeVisible();
  await synced(page);
  await expect.poll(() => server.ledger.recurring).toEqual([]);
  expect(server.ledger.transactions).toEqual([]);

  // It stays gone after another reload.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Rent, payday, the usuals." })).toBeVisible();
  expect(server.ledger.recurring).toEqual([]);
});
