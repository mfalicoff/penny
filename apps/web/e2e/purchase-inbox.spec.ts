import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext } from "@playwright/test";
import { expect, motionSettled, test } from "./test";

// Captured purchases (MAZ-291) on the production build: the Inbox lists a purchase beside an
// emailed receipt with one count, the purchase sheet adds it with its card's account, a second
// purchase is discarded and brought back with Undo, and the screens pass axe. /api is mocked with
// the server's rules for the purchase Inbox. Synthetic data only.

const EMAIL = "alex@example.test";
const id = (n: number) => n.toString(16).padStart(32, "0");
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function mockApi(context: BrowserContext) {
  const now = Date.now();
  const server = {
    revision: 1,
    ledger: {
      version: 4,
      currency: "CAD",
      accounts: [{ id: "visa", name: "Visa", type: "credit" }],
      trips: [],
      categories: [
        { id: "groceries", name: "Groceries", icon: "basket-outline", color: "#6C9C79", kind: "expense" },
        { id: "food", name: "Food & drinks", icon: "cafe-outline", color: "#E47850", kind: "expense" },
      ],
      transactions: [{ id: "old", title: "Metro", kind: "expense", total: 3000, share: 3000, categoryId: "groceries", date: "2026-10-01", note: "" }] as { id: string; title: string; kind: string; total: number; share: number; accountId?: string; categoryId: string; date: string; note: string }[],
      recurring: [],
    },
    purchases: [
      { id: id(1), merchant: "Metro", amount: 5418, currency: "CAD", card: "Visa 0001", capturedAt: now - 26 * 3_600_000, createdAt: now, status: "to_review", outcome: null as string | null, entryId: null as string | null, householdId: null, resolvedAt: null as number | null },
      { id: id(2), merchant: "Corner Bakery", amount: 450, currency: "CAD", card: null, capturedAt: now - 3_600_000, createdAt: now, status: "to_review", outcome: null as string | null, entryId: null as string | null, householdId: null, resolvedAt: null as number | null },
    ],
    resolutions: [] as { outcome: string; entryId?: string }[],
  };
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname, searchParams } = new URL(request.url());
    if (pathname === "/api/info") return route.fulfill({ json: { name: "penny", version: "2.0.0-e2e" } });
    if (pathname === "/api/auth/oidc") return route.fulfill({ json: { enabled: false, providers: [] } });
    if (pathname === "/api/auth/me") return route.fulfill({ json: { email: EMAIL } });
    if (pathname === "/api/ledger") {
      if (request.method() === "PUT") {
        const body = request.postDataJSON() as { revision: number; ledger: typeof server.ledger };
        if (body.revision !== server.revision) return route.fulfill({ status: 409, json: { error: "The ledger changed." } });
        server.revision += 1;
        server.ledger = body.ledger;
      }
      return route.fulfill({ json: { revision: server.revision, ledger: server.ledger } });
    }
    if (pathname === "/api/households/projection") return route.fulfill({ json: { transactions: [], scheduled: [] } });
    if (pathname === "/api/households") return route.fulfill({ json: { households: [] } });
    if (pathname === "/api/v1/search/transactions") return route.fulfill({ json: { version: 1, items: [], totalCount: 0, nextCursor: null } });
    if (pathname === "/api/receipt-email") return route.fulfill({ json: { enabled: true, domain: "receipts.example", address: null } });
    if (pathname === "/api/receipt-inbox") {
      const items = searchParams.get("status") === "attached" ? [] : [{ id: id(9), from: `"Acme Store" <billing@acme.example>`, subject: "Order 4412", receivedAt: now - 86_400_000 * 3, status: "to_attach", senderVerified: true, expiresAt: now + 86_400_000 * 20, attachedAt: null, files: [{ receiptId: id(10), kind: "email", name: "Email PDF", mime: "application/pdf", sizeBytes: 2048, linked: false, uri: `/api/receipts/${id(10)}` }] }];
      return route.fulfill({ json: { items, next: null } });
    }
    if (pathname === "/api/purchase-inbox/cards") return route.fulfill({ json: { cards: [{ card: "Visa 0001", accountId: "visa" }] } });
    if (pathname === "/api/purchase-inbox") return route.fulfill({ json: { items: server.purchases.filter((item) => item.status === (searchParams.get("status") ?? "to_review")), next: null } });
    const action = /^\/api\/purchase-inbox\/([0-9a-f]{32})\/(resolve|reopen)$/.exec(pathname);
    const item = action ? server.purchases.find((candidate) => candidate.id === action[1]) : undefined;
    if (action && item) {
      if (action[2] === "reopen") Object.assign(item, { status: "to_review", outcome: null, entryId: null, resolvedAt: null });
      else {
        const body = request.postDataJSON() as { outcome: string; entryId?: string };
        server.resolutions.push(body);
        Object.assign(item, { status: "done", outcome: body.outcome, entryId: body.entryId ?? null, resolvedAt: Date.now() });
      }
      return route.fulfill({ json: item });
    }
    return route.fulfill({ status: 404, json: { error: "API route not found." } });
  });
  return server;
}

test("a captured purchase is added with its card's account, another is discarded and restored", async ({ page, context, isMobile }) => {
  const server = await mockApi(context);
  await page.goto("/receipts");
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
  if (!isMobile) await expect(page.getByRole("complementary", { name: "Penny" }).getByRole("link", { name: /^Inbox\W*3\s*to review$/ })).toBeVisible();
  const purchases = page.getByRole("list", { name: "Purchases to review" });
  await expect(purchases.getByRole("button", { name: /^Metro/ })).toBeVisible();
  await expect(page.getByRole("list", { name: "Receipts to attach" })).toContainText("Acme Store");
  await motionSettled(page);
  // The Inbox itself; the shell's known design-kit gaps are tracked by a11y.spec.ts (e2e/a11y-known.json).
  expect((await new AxeBuilder({ page }).include(".inbox").withTags(TAGS).analyze()).violations.map((violation) => violation.id)).toEqual([]);

  await purchases.getByRole("button", { name: /^Metro/ }).click();
  const sheet = page.getByRole("dialog", { name: "Purchase" });
  await expect(sheet.getByText("Suggested from your last Metro entry")).toBeVisible();
  await expect(sheet.getByText("From your Visa 0001 card")).toBeVisible();
  await motionSettled(page);
  // Contrast inside the sheet is the design kit's, as in Add entry: white on the accent button and
  // on a chosen chip, and red text on the footer (the known gaps in e2e/a11y-known.json).
  expect((await new AxeBuilder({ page }).include("[role=dialog]").withTags(TAGS).disableRules(["color-contrast"]).analyze()).violations.map((violation) => violation.id)).toEqual([]);
  await sheet.getByRole("button", { name: /Add expense/ }).click();
  await expect(sheet).toBeHidden();
  await expect.poll(() => server.resolutions.length).toBe(1);
  const entryId = server.resolutions[0]?.entryId;
  await expect.poll(() => server.ledger.transactions.find((entry) => entry.id === entryId)).toMatchObject({ title: "Metro", total: 5418, accountId: "visa", categoryId: "groceries" });
  await expect(purchases.getByRole("button", { name: /^Metro/ })).toHaveCount(0);

  await purchases.getByRole("button", { name: /^Corner Bakery/ }).click();
  await page.getByRole("dialog", { name: "Purchase" }).getByRole("button", { name: "Discard" }).click();
  await expect(page.getByText("Purchase discarded")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(purchases.getByRole("button", { name: /^Corner Bakery/ })).toBeVisible();
});
