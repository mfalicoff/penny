import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./test";
import { syntheticPdf } from "./fixtures/receipts";

// Emailed receipts (MAZ-184) on the production build under the production CSP: from the sidebar's
// Receipts to attach, open an email, choose its invoice, pick the suggested expense, look at the
// confirm step (its thumbnail is painted by pdf.js), attach, then Undo. /api is mocked with the
// server's rule that a ledger save linking an inbox file moves its item. Synthetic data only.

const EMAIL = "alex@example.test";
const NOV_14 = Date.parse("2026-11-14T15:00:00Z");
const id = (n: number) => n.toString(16).padStart(32, "0");

interface Entry {
  id: string;
  title: string;
  kind: "expense";
  total: number;
  share: number;
  categoryId: string;
  date: string;
  note: string;
  receipt?: { id: string; name: string; mime: string; uri: string };
}

interface InboxFile {
  receiptId: string;
  kind: "email" | "attachment";
  name: string;
  mime: string;
  sizeBytes: number;
  linked: boolean;
  uri: string;
}

async function mockApi(context: BrowserContext) {
  const pdf = syntheticPdf(1);
  const file = (receiptId: string, kind: InboxFile["kind"], name: string): InboxFile => ({ receiptId, kind, name, mime: "application/pdf", sizeBytes: pdf.length, linked: false, uri: `/api/receipts/${receiptId}` });
  const server = {
    revision: 1,
    ledger: {
      version: 4,
      currency: "CAD",
      accounts: [],
      trips: [],
      categories: [{ id: "food", name: "Food & drinks", icon: "cafe-outline", color: "#E47850", kind: "expense" }],
      transactions: [
        { id: "lunch", title: "Lunch at Mill St.", kind: "expense", total: 1450, share: 1450, categoryId: "food", date: "2026-11-12", note: "" },
        { id: "old", title: "Older dinner", kind: "expense", total: 3000, share: 3000, categoryId: "food", date: "2026-10-01", note: "" },
      ] as Entry[],
      recurring: [],
    },
    item: {
      id: id(1),
      from: `"Mill St. Café" <receipts@mill.example>`,
      subject: "Your receipt <b>#4012</b>",
      receivedAt: Date.parse("2026-11-12T18:00:00Z"),
      status: "to_attach" as "to_attach" | "partly_attached" | "attached",
      senderVerified: false,
      expiresAt: Date.parse("2026-12-12T18:00:00Z"),
      attachedAt: null as number | null,
      files: [file(id(11), "email", "Email PDF"), file(id(12), "attachment", "invoice-4012.pdf")],
    },
  };
  const relink = () => {
    const linked = new Set(server.ledger.transactions.flatMap((entry) => (entry.receipt ? [entry.receipt.id] : [])));
    for (const item of server.item.files) item.linked = linked.has(item.receiptId);
    const count = server.item.files.filter((item) => item.linked).length;
    server.item.status = count === 0 ? "to_attach" : count === server.item.files.length ? "attached" : "partly_attached";
  };
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname, searchParams } = new URL(request.url());
    if (pathname === "/api/info") return route.fulfill({ json: { name: "penny", version: "2.0.0-e2e" } });
    if (pathname === "/api/auth/oidc") return route.fulfill({ json: { enabled: false } });
    if (pathname === "/api/auth/me") return route.fulfill({ json: { email: EMAIL } });
    if (pathname === "/api/ledger") {
      if (request.method() === "PUT") {
        const body = request.postDataJSON() as { revision: number; ledger: typeof server.ledger };
        if (body.revision !== server.revision) return route.fulfill({ status: 409, json: { error: "The ledger changed." } });
        server.revision += 1;
        server.ledger = body.ledger;
        relink();
      }
      return route.fulfill({ json: { revision: server.revision, ledger: server.ledger } });
    }
    if (pathname === "/api/households/projection") return route.fulfill({ json: { transactions: [], scheduled: [] } });
    if (pathname === "/api/households") return route.fulfill({ json: { households: [] } });
    if (pathname === "/api/v1/search/transactions") return route.fulfill({ json: { version: 1, items: [], totalCount: 0, nextCursor: null } });
    if (pathname === "/api/receipt-email") {
      return route.fulfill({
        json: {
          enabled: true,
          domain: "receipts.example",
          address: { address: "r-abcdefghijklmnopqrst@receipts.example", createdAt: NOV_14 - 86_400_000, expiresAt: NOV_14 + 80 * 86_400_000, lastReceivedAt: null, allowedSenders: [] },
        },
      });
    }
    if (pathname === "/api/receipt-inbox") {
      const attached = searchParams.get("status") === "attached";
      const items = (server.item.status === "attached") === attached ? [server.item] : [];
      return route.fulfill({ json: { items, next: null } });
    }
    if (/^\/api\/receipts\/[0-9a-f]{32}$/.test(pathname) && request.method() === "GET") {
      return route.fulfill({ status: 200, body: pdf, headers: { "Content-Type": "application/pdf", "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "no-store" } });
    }
    return route.fulfill({ status: 404, json: { error: "API route not found." } });
  });
  return server;
}

function watchForErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") errors.push(`console.${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

async function openInbox(page: Page, isMobile: boolean) {
  await page.getByRole("heading", { level: 1 }).waitFor();
  if (isMobile) {
    // Phones: Home's settings button, then Manage.
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("navigation", { name: "Manage" }).getByRole("link", { name: "Receipts to attach, 1 receipt to attach" }).click();
  } else {
    await page.getByRole("complementary", { name: "Penny" }).getByRole("link", { name: "Receipts to attach, 1 receipt to attach" }).click();
  }
  await expect(page.getByRole("heading", { level: 1, name: "Receipts to attach" })).toBeVisible();
}

test("attaches an emailed invoice to the suggested expense, then undoes it", async ({ context, page, isMobile }) => {
  const errors = watchForErrors(page);
  const server = await mockApi(context);
  await page.clock.setFixedTime(NOV_14);
  await page.goto("/");
  await openInbox(page, isMobile);

  const list = page.getByRole("list", { name: "Receipts to attach" });
  const row = list.getByRole("button", { name: /Mill St\. Café/ });
  // Untrusted text stays text.
  await expect(row).toContainText("Your receipt <b>#4012</b>");
  await expect(row.getByText("Sender not verified")).toBeVisible();
  await row.click();

  const detail = page.getByRole("dialog", { name: "Mill St. Café" });
  await detail.getByRole("button", { name: "Attach to…" }).click();
  const fileStep = page.getByRole("dialog", { name: "Which file?" });
  await expect(fileStep.getByRole("radio", { name: /invoice-4012\.pdf/ })).toBeChecked();
  await fileStep.getByRole("button", { name: "Next" }).click();

  const suggested = page.getByRole("dialog", { name: "Attach to…" }).getByRole("list", { name: "Suggested expenses" });
  await expect(suggested.getByRole("button")).toHaveCount(1);
  await suggested.getByRole("button", { name: /Lunch at Mill St\./ }).click();

  const confirm = page.getByRole("dialog", { name: "Attach receipt?" });
  await expect(confirm).toContainText("Penny couldn't verify who sent this email. Check the receipt before attaching it.");
  // The thumbnail is pdf.js's first page, painted under the production CSP.
  await expect.poll(() => confirm.locator(".inbox-thumb canvas").evaluate((canvas: HTMLCanvasElement) => !canvas.hidden && canvas.width > 0)).toBe(true);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await confirm.getByRole("button", { name: "Attach invoice-4012.pdf to Lunch at Mill St., $14.50, November 12" }).click();

  await expect(page.getByText("Receipt attached to Lunch at Mill St.")).toBeVisible();
  await expect.poll(() => server.ledger.transactions.find((entry) => entry.id === "lunch")?.receipt?.id).toBe(id(12));
  await expect(list).toContainText("1 of 2 attached");

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Receipt removed")).toBeVisible();
  await expect.poll(() => server.ledger.transactions.find((entry) => entry.id === "lunch")?.receipt).toBeUndefined();
  await expect(list).not.toContainText("attached");
  expect(errors).toEqual([]);
});

test("at 320px the attached toast shows its whole title, with its buttons on a row below it (MAZ-205)", async ({ context, page }) => {
  const errors = watchForErrors(page);
  await mockApi(context);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.clock.setFixedTime(NOV_14);
  await page.goto("/receipts");
  await page.getByRole("list", { name: "Receipts to attach" }).getByRole("button", { name: /Mill St\. Café/ }).click();
  await page.getByRole("dialog", { name: "Mill St. Café" }).getByRole("button", { name: "Attach to…" }).click();
  await page.getByRole("dialog", { name: "Which file?" }).getByRole("button", { name: "Next" }).click();
  await page.getByRole("list", { name: "Suggested expenses" }).getByRole("button", { name: /Lunch at Mill St\./ }).click();
  await page.getByRole("dialog", { name: "Attach receipt?" }).getByRole("button", { name: /^Attach invoice-4012\.pdf/ }).click();

  const toast = page.locator(".pk-toast", { hasText: "Receipt attached to Lunch at Mill St." });
  await expect(toast).toBeVisible();
  await toast.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  const layout = await toast.evaluate((element) => {
    const title = element.querySelector(".pk-toast__title");
    const main = document.querySelector("main");
    if (!title || !main) throw new Error("No toast title or main area");
    return {
      toast: element.getBoundingClientRect(),
      title: title.getBoundingClientRect(),
      cut: title.scrollWidth > title.clientWidth || title.scrollHeight > title.clientHeight,
      buttons: [...element.querySelectorAll("button")].map((button) => button.getBoundingClientRect()),
      room: parseFloat(getComputedStyle(main).paddingBottom),
      viewport: window.innerHeight,
    };
  });
  // Most of the toast's width goes to the title, which isn't cut short.
  expect(layout.title.width).toBeGreaterThan(200);
  expect(layout.cut).toBe(false);
  // View entry, Undo and Dismiss share one row below the title, inside the toast.
  expect(layout.buttons).toHaveLength(3);
  const [first] = layout.buttons;
  for (const button of layout.buttons) {
    expect(button.top).toBeGreaterThanOrEqual(layout.title.bottom - 1);
    expect(Math.abs(button.top - (first?.top ?? 0))).toBeLessThanOrEqual(1);
    expect(button.right).toBeLessThanOrEqual(layout.toast.right);
  }
  // It stays inside the room the main area always keeps at the bottom, so the last rows scroll clear of it.
  expect(layout.viewport - layout.toast.top).toBeLessThanOrEqual(layout.room);
  await expect(toast.getByRole("button", { name: "View entry" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("from 768px the attached toast is 560px wide, with its title beside its buttons (MAZ-208)", async ({ context, page }) => {
  const errors = watchForErrors(page);
  await mockApi(context);
  await page.setViewportSize({ width: 768, height: 900 });
  await page.clock.setFixedTime(NOV_14);
  await page.goto("/receipts");
  await page.getByRole("list", { name: "Receipts to attach" }).getByRole("button", { name: /Mill St\. Café/ }).click();
  await page.getByRole("dialog", { name: "Mill St. Café" }).getByRole("button", { name: "Attach to…" }).click();
  await page.getByRole("dialog", { name: "Which file?" }).getByRole("button", { name: "Next" }).click();
  await page.getByRole("list", { name: "Suggested expenses" }).getByRole("button", { name: /Lunch at Mill St\./ }).click();
  await page.getByRole("dialog", { name: "Attach receipt?" }).getByRole("button", { name: /^Attach invoice-4012\.pdf/ }).click();

  const toast = page.locator(".pk-toast", { hasText: "Receipt attached to Lunch at Mill St." });
  await expect(toast).toBeVisible();
  await toast.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  const layout = await toast.evaluate((element) => {
    const title = element.querySelector(".pk-toast__title");
    if (!title) throw new Error("No toast title");
    const box = title.getBoundingClientRect();
    return {
      toast: element.getBoundingClientRect(),
      title: box,
      lines: Math.round(box.height / parseFloat(getComputedStyle(title).lineHeight)),
      buttons: [...element.querySelectorAll("button")].map((button) => button.getBoundingClientRect()),
    };
  });
  // The toast is as wide as on the web card, and the title wraps to two lines at most.
  expect(Math.round(layout.toast.width)).toBe(560);
  expect(layout.title.width).toBeGreaterThan(200);
  expect(layout.lines).toBeLessThanOrEqual(2);
  // View entry, Undo and Dismiss stay on the title's row, to its right, inside the toast.
  expect(layout.buttons).toHaveLength(3);
  for (const button of layout.buttons) {
    expect(button.left).toBeGreaterThanOrEqual(layout.title.right - 1);
    expect(button.top).toBeLessThan(layout.title.bottom);
    expect(button.right).toBeLessThanOrEqual(layout.toast.right);
  }
  expect(errors).toEqual([]);
});

test("the inbox fits a 320px screen and opens rows from the keyboard", async ({ context, page }) => {
  const errors = watchForErrors(page);
  await mockApi(context);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.clock.setFixedTime(NOV_14);
  await page.goto("/receipts");
  const row = page.getByRole("list", { name: "Receipts to attach" }).getByRole("button", { name: /Mill St\. Café/ });
  await row.focus();
  await page.keyboard.press("Enter");
  const detail = page.getByRole("dialog", { name: "Mill St. Café" });
  await expect(detail.getByRole("list", { name: "Files" }).getByRole("listitem")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(row).toBeFocused();
  await page.keyboard.press("Delete");
  await expect(page.getByRole("dialog", { name: "Discard this email?" })).toContainText("Its 2 files will be deleted. This can't be undone.");
  await page.keyboard.press("Escape");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});
