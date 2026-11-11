import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// The durable offline store (MAZ-87) in real Chromium: IndexedDB, BroadcastChannel, Web Locks and
// the browser's own offline switch. /api is mocked (a revision-checked ledger); the real
// .NET/PostgreSQL journeys are MAZ-95. Synthetic data only.

const EMAIL = "alex@example.test";
const entry = (id: string, title: string) => ({ id, title, kind: "expense", total: 1200, share: 1200, categoryId: "groceries", date: "2026-11-02", note: "" });
type Entry = ReturnType<typeof entry>;
const emptyLedger = {
  version: 4,
  currency: "CAD",
  accounts: [],
  trips: [],
  categories: [{ id: "groceries", name: "Groceries", icon: "basket-outline", color: "#6C9C79", kind: "expense" }],
  transactions: [] as Entry[],
  recurring: [],
};

interface Server {
  revision: number;
  ledger: typeof emptyLedger;
  down: boolean;
  puts: { revision: number; ledger: Server["ledger"] }[];
}

async function mockApi(context: BrowserContext): Promise<Server> {
  const server: Server = { revision: 3, ledger: { ...emptyLedger, transactions: [entry("a", "Rent")] }, down: false, puts: [] };
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/info") return route.fulfill({ json: { name: "penny", version: "2.0.0-e2e" } });
    if (path === "/api/auth/me") return route.fulfill({ json: { email: EMAIL } });
    if (path === "/api/v1/search/transactions") return route.fulfill({ json: { version: 1, items: [], totalCount: 0, nextCursor: null } });
    if (path === "/api/ledger") {
      if (server.down) return route.abort("connectionrefused");
      if (request.method() === "PUT") {
        const body = request.postDataJSON() as Server["puts"][number];
        if (body.revision !== server.revision) return route.fulfill({ status: 409, json: { error: "The ledger changed." } });
        server.puts.push(body);
        server.revision += 1;
        server.ledger = body.ledger;
      }
      return route.fulfill({ json: { revision: server.revision, ledger: server.ledger } });
    }
    return route.fulfill({ status: 404, json: { error: "API route not found." } });
  });
  return server;
}

const legacyKey = `penny:ledger:${EMAIL}`;

/** What the legacy Expo web app left in localStorage on this origin: a pending "Bakery" entry. */
async function seedLegacyCopy(page: Page) {
  // Any same-origin page will do; the app itself would start syncing before the copy exists.
  await page.goto("/licenses/Inter-OFL.txt");
  const base = { ...emptyLedger, transactions: [entry("a", "Rent")] };
  const local = { ...emptyLedger, transactions: [entry("a", "Rent"), entry("b", "Bakery")] };
  await page.evaluate(([key, value]) => {
    localStorage.setItem(key, value);
  }, [legacyKey, JSON.stringify({ base, local })] as const);
}

const legacyCopy = (page: Page) => page.evaluate((key) => localStorage.getItem(key), legacyKey);

test("imports the legacy copy, keeps it through reloads and tabs while offline, then syncs it once", async ({ context, page }) => {
  const server = await mockApi(context);
  await seedLegacyCopy(page);
  server.down = true;

  await page.goto("/");
  await expect(page.getByText("Not synced · 1 change waiting")).toBeVisible();
  // The original stays until the server has the change.
  expect(await legacyCopy(page)).not.toBeNull();

  // Reload: the change is read back from IndexedDB, not imported twice.
  await page.reload();
  await expect(page.getByText("Not synced · 1 change waiting")).toBeVisible();

  // A second tab sees the same durable work.
  const second = await context.newPage();
  await second.goto("/transactions?q=bakery");
  await expect(second.getByText("1 matching transaction on this device")).toBeVisible();
  await expect(second.getByRole("listitem").filter({ hasText: "Bakery" })).toContainText("Waiting to sync");

  // The browser goes offline, then comes back with the server up.
  await context.setOffline(true);
  await expect(page.getByText("Offline · 1 change waiting")).toBeVisible();
  server.down = false;
  await context.setOffline(false);

  await expect(page.getByText(/change waiting/)).toHaveCount(0);
  await expect(second.getByText(/change waiting/)).toHaveCount(0);
  expect(server.puts).toHaveLength(1);
  expect(server.ledger.transactions.map((item) => item.title)).toEqual(["Rent", "Bakery"]);
  expect(await legacyCopy(page)).toBeNull();

  // Both tabs stay converged: another reload sends nothing new.
  await second.reload();
  await expect(second.getByRole("heading", { level: 1, name: "Activity" })).toBeVisible();
  await expect(second.getByText(/change waiting/)).toHaveCount(0);
  expect(server.puts).toHaveLength(1);
});

test("refuses to sign out while a change is waiting, and allows it once synced", async ({ context, page }) => {
  const server = await mockApi(context);
  await context.route("**/api/auth/logout", (route) => route.fulfill({ json: { ok: true } }));
  await seedLegacyCopy(page);
  server.down = true;
  await page.goto("/settings");
  await expect(page.getByText("Not synced · 1 change waiting")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  const dialog = page.getByRole("dialog", { name: "Sign out of Penny?" });
  await dialog.getByRole("button", { name: "Sign out" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Your changes are still waiting to sync");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  server.down = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText(/change waiting/)).toHaveCount(0);
  expect(server.puts).toHaveLength(1);
});
