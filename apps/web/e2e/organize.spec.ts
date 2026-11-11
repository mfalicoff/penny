import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// Accounts and categories (MAZ-89) in real Chromium over the durable offline ledger (IndexedDB),
// with /api mocked: a revision-checked ledger that also applies the server's household-link rule
// (an account a shared expense you paid uses can't be removed). The real .NET/PostgreSQL journeys
// are MAZ-95. Synthetic data only.

const EMAIL = "alex@example.test";
const LINK_MESSAGE = "Remove household expense links before deleting this payment account.";

interface Account {
  id: string;
  name: string;
  type: string;
}
interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  kind: string;
}
interface Ledger {
  version: 4;
  currency: string;
  accounts: Account[];
  trips: unknown[];
  categories: Category[];
  transactions: Record<string, unknown>[];
  recurring: Record<string, unknown>[];
}

const entry = (id: string, extra: Record<string, unknown>) => ({ id, title: `Entry ${id}`, kind: "expense", total: 1200, share: 1200, categoryId: "groceries", date: "2026-11-02", note: "", ...extra });

function startingLedger(): Ledger {
  return {
    version: 4,
    currency: "CAD",
    accounts: [
      { id: "acct-chq", name: "Everyday chequing", type: "bank" },
      { id: "acct-visa", name: "Visa", type: "credit" },
    ],
    trips: [],
    categories: [
      { id: "groceries", name: "Groceries", icon: "basket-outline", color: "#0FA3A3", kind: "expense" },
      { id: "food", name: "Food & drinks", icon: "cafe-outline", color: "#E0529C", kind: "expense" },
      { id: "salary", name: "Salary", icon: "briefcase-outline", color: "#3B82F6", kind: "income" },
    ],
    transactions: [entry("e1", { accountId: "acct-visa" }), entry("e2", { accountId: "acct-visa", categoryId: "food" })],
    recurring: [],
  };
}

interface Server {
  revision: number;
  ledger: Ledger;
  linked: string[];
  puts: number;
  down: boolean;
}

async function mockApi(context: BrowserContext, linked: string[] = []): Promise<Server> {
  const server: Server = { revision: 3, ledger: startingLedger(), linked, puts: 0, down: false };
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/info") return route.fulfill({ json: { name: "penny", version: "2.0.0-e2e" } });
    if (path === "/api/auth/me") return route.fulfill({ json: { email: EMAIL } });
    if (path === "/api/v1/search/transactions") return route.fulfill({ json: { version: 1, items: [], totalCount: 0, nextCursor: null } });
    if (path === "/api/ledger") {
      if (server.down) return route.abort("connectionrefused");
      if (request.method() === "PUT") {
        const body = request.postDataJSON() as { revision: number; ledger: Ledger };
        const kept = new Set(body.ledger.accounts.map((account) => account.id));
        if (server.linked.some((id) => server.ledger.accounts.some((account) => account.id === id) && !kept.has(id)))
          return route.fulfill({ status: 400, json: { error: LINK_MESSAGE } });
        if (body.revision !== server.revision) return route.fulfill({ status: 409, json: { error: "Your data changed on another device. Please refresh and try again." } });
        server.revision += 1;
        server.ledger = body.ledger;
        server.puts += 1;
      }
      return route.fulfill({ json: { revision: server.revision, ledger: server.ledger } });
    }
    return route.fulfill({ status: 404, json: { error: "API route not found." } });
  });
  return server;
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("account and category journeys: add, rename, move links and remove, by keyboard", async ({ context, page }) => {
  const server = await mockApi(context);
  await page.goto("/accounts");
  await expect(page.getByRole("heading", { level: 1, name: "Accounts" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit Visa" })).toHaveAccessibleDescription("Credit card · 2 entries");

  // Add by keyboard: Enter in the name field submits the dialog's form.
  await page.getByRole("button", { name: "Add account" }).click();
  const add = page.getByRole("dialog", { name: "New account" });
  await expect(add.getByLabel("Name")).toBeFocused();
  await page.keyboard.type("Wallet");
  await add.getByRole("radio", { name: "Cash" }).check();
  await add.getByLabel("Name").press("Enter");
  await expect(add).toBeHidden();
  await expect(page.getByRole("button", { name: "Edit Wallet" })).toHaveAccessibleDescription(/^Cash · not used yet/);
  await expect.poll(() => server.ledger.accounts.map((account) => account.name)).toEqual(["Everyday chequing", "Visa", "Wallet"]);

  // An in-use account: renamed (links stay), then its entries move and it's removed, with Undo.
  await page.getByRole("button", { name: "Edit Visa" }).click();
  let edit = page.getByRole("dialog", { name: "Edit account" });
  await expect(edit.getByText("Visa is used by 2 entries. Move them to another account to remove it.", { exact: false })).toBeVisible();
  await edit.getByLabel("Name").fill("Travel card");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(edit).toBeHidden();
  await page.getByRole("button", { name: "Edit Travel card" }).click();
  edit = page.getByRole("dialog", { name: "Edit account" });
  await edit.getByLabel("Move them to").selectOption({ label: "Everyday chequing" });
  await edit.getByRole("button", { name: "Move and remove" }).click();
  await expect(page.getByText("Travel card removed")).toBeVisible();
  await expect.poll(() => server.ledger.accounts.map((account) => account.name)).toEqual(["Everyday chequing", "Wallet"]);
  expect(server.ledger.transactions.map((item) => item.accountId)).toEqual(["acct-chq", "acct-chq"]);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => server.ledger.accounts.map((account) => account.name)).toEqual(["Everyday chequing", "Wallet", "Travel card"]);
  expect(server.ledger.transactions.map((item) => item.accountId)).toEqual(["acct-visa", "acct-visa"]);

  // Categories: the kind is in the URL; add an income category with a palette color and icon.
  await page.goto("/categories");
  await page.getByRole("radio", { name: "Income" }).check();
  await expect(page).toHaveURL(/\/categories\?kind=income$/);
  await page.getByRole("button", { name: "New category" }).click();
  const category = page.getByRole("dialog", { name: "New category" });
  await page.keyboard.type("Side project");
  await category.getByRole("radio", { name: "Olive" }).check();
  await category.getByRole("radio", { name: "Laptop" }).check();
  await category.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByRole("button", { name: "Edit Side project" })).toBeVisible();
  await expect
    .poll(() => server.ledger.categories.find((item) => item.name === "Side project"))
    .toMatchObject({ kind: "income", color: "#7A8F3A", icon: "laptop-outline" });

  // Back returns to expenses; an in-use category keeps its kind and moves its entries before removal.
  await page.goBack();
  await expect(page.getByRole("radio", { name: "Expense" })).toBeChecked();
  await page.getByRole("button", { name: "Edit Food & drinks" }).click();
  const food = page.getByRole("dialog", { name: "Edit category" });
  await expect(food.getByRole("radio", { name: "Income" })).toBeDisabled();
  await food.getByLabel("Move them to").selectOption({ label: "Groceries" });
  await food.getByRole("button", { name: "Move and remove" }).click();
  await expect.poll(() => server.ledger.categories.map((item) => item.name)).toEqual(["Groceries", "Salary", "Side project"]);
  expect(server.ledger.transactions.map((item) => item.categoryId)).toEqual(["groceries", "groceries"]);
});

test("changes made offline wait in this browser, survive a reload and sync once back online", async ({ context, page }) => {
  const server = await mockApi(context);
  await page.goto("/categories");
  await expect(page.getByRole("button", { name: "Edit Groceries" })).toBeVisible();
  // Mocked routes still answer while the browser is offline, so the server goes down with it.
  server.down = true;
  await context.setOffline(true);

  await page.getByRole("button", { name: "Edit Groceries" }).click();
  const form = page.getByRole("dialog", { name: "Edit category" });
  await form.getByLabel("Name").fill("Groceries & dining");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved on this device. It syncs when you're back online.")).toBeVisible();
  const row = page.getByRole("button", { name: "Edit Groceries & dining" });
  await expect(row.getByText("Waiting to sync")).toBeVisible();
  await expect(page.getByText("Offline · 1 change waiting")).toBeVisible();

  // Back online but the server is still unreachable: a reload reads the change back from IndexedDB.
  await context.setOffline(false);
  await page.reload();
  await expect(row.getByText("Waiting to sync")).toBeVisible();
  const banner = page.locator(".pk-banner").filter({ hasText: "Not synced · 1 change waiting" });
  await expect(banner).toBeVisible();
  expect(server.puts).toBe(0);

  server.down = false;
  await banner.getByRole("button", { name: "Retry" }).click();
  await expect.poll(() => server.ledger.categories[0]?.name).toBe("Groceries & dining");
  await expect(row.getByText("Waiting to sync")).toBeHidden();
  expect(server.puts).toBe(1);
});

test("the server keeps an account a shared expense links, and Put it back lets the rest sync", async ({ context, page }) => {
  const server = await mockApi(context, ["acct-chq"]);
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Edit Everyday chequing" }).click();
  await page.getByRole("dialog", { name: "Edit account" }).getByRole("button", { name: "Remove account" }).click();
  const banner = page.getByRole("alert").filter({ hasText: "Everyday chequing can't be removed yet" });
  await expect(banner).toContainText("A shared expense or repeating shared expense you paid is linked to it");
  await banner.getByRole("button", { name: "Put it back" }).click();
  await expect(banner).toBeHidden();
  await expect(page.getByRole("button", { name: "Edit Everyday chequing" })).toBeVisible();
  expect(server.ledger.accounts.map((account) => account.name)).toEqual(["Everyday chequing", "Visa"]);
});

test("long names and dialogs fit a 320px screen and doubled text without horizontal scrolling", async ({ context, page }) => {
  const server = await mockApi(context);
  const long = "An extraordinarily long account name for testing";
  server.ledger.accounts.push({ id: "acct-long", name: long, type: "other" });
  server.ledger.categories.push({ id: "c-long", name: "Supercalifragilisticexpialidocious groceries", icon: "leaf-outline", color: "#7A8F3A", kind: "expense" });
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of ["/accounts", "/categories"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.getByRole("button", { name: /^Edit / }).first().waitFor();
    expect(await overflow(page)).toBe(0);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    expect(await overflow(page)).toBe(0);
    await page.getByRole("button", { name: /^Edit / }).last().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    expect(await overflow(page)).toBe(0);
    const box = await dialog.locator(".dialog__panel").boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 320).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "";
    });
  }
});

test("the category form marks the chosen color and icon in light, dark, forced colors and reduced transparency", async ({ context, page }) => {
  await mockApi(context);
  const appearances = [
    { name: "light", media: { colorScheme: "light" as const } },
    { name: "dark", media: { colorScheme: "dark" as const } },
    { name: "forced colors", media: { forcedColors: "active" as const } },
    { name: "reduced transparency", media: { colorScheme: "light" as const }, transparency: true },
  ];
  for (const appearance of appearances) {
    await page.emulateMedia({ colorScheme: null, forcedColors: null, ...appearance.media });
    await page.goto("/categories");
    if (appearance.transparency)
      await page.evaluate(() => {
        document.documentElement.dataset.transparency = "reduced";
      });
    await page.getByRole("button", { name: "Edit Groceries" }).click();
    const form = page.getByRole("dialog", { name: "Edit category" });
    const swatch = form.getByRole("radio", { name: "Teal" });
    await expect(swatch, appearance.name).toBeChecked();
    // The selection is drawn with a ring (a system outline in forced colors), not by color alone.
    const marked = await swatch.evaluate((input) => {
      const dot = getComputedStyle(input.nextElementSibling as Element);
      return dot.boxShadow !== "none" || dot.outlineStyle !== "none";
    });
    expect(marked, appearance.name).toBe(true);
    await expect(form.getByRole("radio", { name: "Basket" }), appearance.name).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(form).toBeHidden();
  }
});
