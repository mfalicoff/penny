import { expect, test, type Page } from "@playwright/test";
import { LedgerClient, realStack, signIn, skipReason, testUser } from "./stack";

// MAZ-96 personal money journey against the real .NET API and PostgreSQL, from an empty account:
// Settings › Currency while the ledger is empty, an account and a category, income, an expense on
// that account and an investment, a monthly schedule, Home's recorded and projected values, the
// currency lock, a pinned theme kept through a reload, and the server's copy matching what the
// browser shows. In apps/web:
//
//   npm run build && npm run test:e2e:real -- financial.real
test.skip(!realStack, skipReason);
test.describe.configure({ timeout: 120_000 });

const AT = "2026-10-20T15:00:00Z";
const hero = (page: Page) => page.getByRole("region", { name: "Left to spend" });

async function addEntry(page: Page, values: { kind?: "Income" | "Investment"; amount: string; title: string; date: string; category?: string; account?: string }) {
  await page.getByRole("button", { name: "Add entry" }).first().click();
  const add = page.getByRole("form", { name: "Add entry" });
  if (values.kind) await add.getByRole("radio", { name: values.kind, exact: true }).check({ force: true });
  await add.getByLabel("Amount (EUR)").fill(values.amount);
  await add.getByLabel("Title").fill(values.title);
  if (values.category) {
    // A new category isn't among the frequent chips yet: pick it from All categories.
    await add.getByRole("button", { name: "All categories" }).click();
    await page.getByRole("dialog", { name: "Choose a category" }).getByRole("button", { name: values.category }).click();
    await expect(add.getByRole("radio", { name: values.category, exact: true })).toBeChecked();
  }
  await add.getByLabel("Date").fill(values.date);
  if (values.account) {
    await add.getByRole("button", { name: /More details/ }).click();
    await add.getByLabel("Account").selectOption({ label: values.account });
  }
  await page.getByRole("dialog", { name: "Add entry" }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog", { name: "Add entry" })).toHaveCount(0);
}

test("currency, organize, income, expense, investment, a schedule and Home's totals match the server", async ({ browser, baseURL }) => {
  const user = await testUser("money");
  const server = await LedgerClient.signIn(user);
  const { page, context } = await signIn(browser, baseURL, user, AT);

  // Currency can be chosen while the ledger is empty, and the server stores it.
  await page.goto("/settings/currency");
  await expect(page.getByText(/Choose your currency before adding entries/)).toBeVisible();
  const eur = page.getByRole("radio", { name: "EUR" });
  await expect(async () => {
    await eur.check({ force: true, timeout: 2_000 });
  }).toPass();
  await expect.poll(async () => (await server.read()).ledger.currency).toBe("EUR");
  await expect(eur).toBeChecked();

  // An account and a category.
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Add account" }).click();
  const account = page.getByRole("dialog", { name: "New account" });
  await account.getByLabel("Name").fill("Daily card");
  await account.getByRole("radio", { name: "Credit card" }).check({ force: true });
  await account.getByLabel("Name").press("Enter");
  await expect(account).toBeHidden();
  await page.goto("/categories");
  await page.getByRole("button", { name: "New category" }).click();
  const category = page.getByRole("dialog", { name: "New category" });
  await category.getByLabel("Name").fill("Bakery");
  await category.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByRole("button", { name: "Edit Bakery" })).toBeVisible();

  // Income, an expense on the new account and category, and an investment.
  await page.goto("/transactions?month=2026-10");
  await addEntry(page, { kind: "Income", amount: "3000", title: "October pay", date: "2026-10-01" });
  await addEntry(page, { amount: "18.40", title: "Sourdough", date: "2026-10-12", category: "Bakery", account: "Daily card" });
  await addEntry(page, { kind: "Investment", amount: "250", title: "Index fund", date: "2026-10-05" });

  // A monthly schedule later this month: projected, not recorded.
  await page.goto("/recurring");
  await page.getByRole("button", { name: "New schedule" }).first().click();
  const schedule = page.getByRole("dialog", { name: "New schedule" });
  await schedule.getByLabel("Amount (EUR)").fill("45");
  await schedule.getByLabel("Name").fill("Gym");
  await schedule.getByRole("radio", { name: "Monthly" }).check({ force: true });
  await schedule.getByLabel("First date").fill("2026-10-31");
  await schedule.getByRole("button", { name: "Add schedule" }).click();
  await expect(page.getByText("Gym added")).toBeVisible();
  await expect(page.getByText(/changes? waiting/)).toHaveCount(0);

  // The server holds exactly what was entered, linked to the new account and category.
  await expect
    .poll(async () => {
      const { ledger } = await server.read();
      return [ledger.transactions.length, (ledger.recurring as unknown[]).length];
    })
    .toEqual([3, 1]);
  const stored = await server.read();
  const bakery = stored.ledger.categories.find((item) => item.name === "Bakery");
  const card = stored.ledger.accounts.find((item) => item.name === "Daily card");
  expect(stored.ledger.transactions.find((item) => item.title === "Sourdough")).toMatchObject({ total: 1840, share: 1840, kind: "expense", categoryId: bakery?.id, accountId: card?.id });
  expect(stored.ledger.transactions.find((item) => item.title === "October pay")).toMatchObject({ total: 300000, kind: "income" });
  expect(stored.ledger.transactions.find((item) => item.title === "Index fund")).toMatchObject({ total: 25000, kind: "investment" });
  expect((stored.ledger.recurring as { title: string; nextDate: string }[]).map((rule) => [rule.title, rule.nextDate])).toEqual([["Gym", "2026-10-31"]]);

  // Home: recorded remaining = 3,000.00 − 18.40 − 250.00; projected also takes the 45.00 Gym.
  await page.goto("/");
  await expect(hero(page).locator(".hero__amount")).toHaveText("Recorded remaining: €2,731.60");
  await expect(hero(page)).toContainText("€2,686.60 projected remaining");
  await expect(hero(page)).toContainText("€45.00 scheduled to go out");
  // A reload reads the same from the server, not a stale cache.
  await page.reload();
  await expect(hero(page).locator(".hero__amount")).toHaveText("Recorded remaining: €2,731.60");

  // With entries recorded, the currency is locked.
  await page.goto("/settings/currency");
  await expect(page.getByText("Your ledger already has entries in EUR, so the currency can't change.")).toBeVisible();

  // A pinned dark theme survives a reload.
  await page.goto("/settings/appearance");
  await page.getByRole("radio", { name: "Dark" }).check({ force: true });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await context.close();
});
