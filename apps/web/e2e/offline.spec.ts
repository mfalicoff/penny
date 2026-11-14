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

/**
 * A pending "Bakery" entry already in this browser's offline store (`penny-offline`, format 1),
 * on top of the server's revision 3, as a save made offline leaves it.
 */
async function seedPendingChange(page: Page) {
  // Any same-origin page will do; the app itself would start syncing before the record exists.
  await page.goto("/licenses/Inter-OFL.txt");
  const base = { ...emptyLedger, transactions: [entry("a", "Rent")] };
  const local = { ...emptyLedger, transactions: [entry("a", "Rent"), entry("b", "Bakery")] };
  await page.evaluate(async ([email, value]) => {
    const record = { format: 1, server: location.origin, email, baseRevision: 3, lastSyncedAt: null, savedAt: new Date().toISOString(), ...value };
    await new Promise<void>((resolve, reject) => {
      const opening = indexedDB.open("penny-offline", 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore("ledgers");
      opening.onerror = () => { reject(opening.error ?? new Error("open failed")); };
      opening.onsuccess = () => {
        const db = opening.result;
        const write = db.transaction("ledgers", "readwrite");
        write.objectStore("ledgers").put(record, `ledger\n${location.origin}\n${email}`);
        write.oncomplete = () => { db.close(); resolve(); };
        write.onerror = () => { reject(write.error ?? new Error("write failed")); };
      };
    });
  }, [EMAIL, { base, local }] as const);
}

test("keeps a pending change through reloads and tabs while offline, then syncs it once", async ({ context, page }) => {
  const server = await mockApi(context);
  await seedPendingChange(page);
  server.down = true;

  await page.goto("/");
  await expect(page.getByText("Not synced · 1 change waiting")).toBeVisible();
  // Reload: the change is read back from IndexedDB.
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

  // Both tabs stay converged: another reload sends nothing new.
  await second.reload();
  await expect(second.getByRole("heading", { level: 1, name: "Activity" })).toBeVisible();
  await expect(second.getByText(/change waiting/)).toHaveCount(0);
  expect(server.puts).toHaveLength(1);
});

test("refuses to sign out while a change is waiting, and allows it once synced", async ({ context, page }) => {
  const server = await mockApi(context);
  await context.route("**/api/auth/logout", (route) => route.fulfill({ json: { ok: true } }));
  await seedPendingChange(page);
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
