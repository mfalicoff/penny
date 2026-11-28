import { configure, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { entry, setOnline } from "./fakes/ledgerServer";
import { inboxItem, inboxServer, localNoon, purchase } from "./fakes/inboxServer";
import { ALEX, json, renderApp } from "./render";

/**
 * Captured purchases in the Inbox (MAZ-291, cards `web-inbox-captured`, `web-capture-*`): the
 * combined count, the list with suggested categories and matches, Add with the card's account
 * and the day's rate, Discard with Undo, Attach to an entry, and Add all. Synthetic data only.
 */

configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  setOnline(true);
});

const sidebar = async () => (await screen.findAllByRole("complementary", { name: "Penny" }))[0] as HTMLElement;
const purchaseList = () => screen.findByRole("list", { name: "Purchases to review" });

const ledger = {
  accounts: [
    { id: "chq", name: "Chequing", type: "bank" },
    { id: "visa", name: "Visa", type: "credit" },
  ],
  transactions: [entry("old-steam", "Steam", { categoryId: "food", date: "2026-10-01", total: 2000, share: 2000 })],
};

const rates = () => (url: string) => {
  const date = new URL(url, "https://penny.test").searchParams.get("date") ?? "";
  return json({ enabled: true, source: "European Central Bank", base: "CAD", date, rateDate: date, provisional: false, latestDate: date, rates: { USD: "1.3742" } });
};

describe("the Inbox count", () => {
  it("counts purchases to review and receipts to attach together", async () => {
    inboxServer({ items: [inboxItem(1)], purchases: [purchase(1), purchase(2), purchase(3, { status: "done", outcome: "discarded", resolvedAt: 1 })] });
    renderApp("/");
    const link = await within(await sidebar()).findByRole("link", { name: /^Inbox\W*3\s*to review$/ });
    expect(link).toHaveAttribute("href", "/receipts?status=to_review");
  });

  it("shows the Inbox for purchases alone, with emailed receipts off", async () => {
    inboxServer({ enabled: false, purchases: [purchase(1)] });
    renderApp("/receipts");
    await within(await sidebar()).findByRole("link", { name: /^Inbox\W*1\s*to review$/ });
    expect(await purchaseList()).toHaveTextContent("Shop 1");
    expect(screen.queryByRole("heading", { name: "Emailed receipts" })).not.toBeInTheDocument();
  });
});

describe("the list", () => {
  it("lists purchases first, then emailed receipts, with the suggested category, card and a receipt match", async () => {
    inboxServer({
      ledger,
      items: [inboxItem(1, { from: `"Shop 1" <billing@shop.example>`, receivedAt: localNoon("2026-11-12") + 60_000 })],
      purchases: [purchase(1), purchase(2, { merchant: "Steam", amount: 3499, currency: "USD", card: "Amex 0002", capturedAt: localNoon("2026-11-10") })],
      rates: rates(),
    });
    renderApp("/receipts");
    const list = await purchaseList();
    await screen.findByRole("heading", { name: "Emailed receipts" });
    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings.indexOf("Purchases")).toBeLessThan(headings.indexOf("Emailed receipts"));
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Shop 1");
    expect(rows[0]).toHaveTextContent("Visa 0001");
    expect(rows[0]).toHaveTextContent("Matches a receipt");
    await waitFor(() => {
      expect(rows[1]).toHaveTextContent("Food & drinks · Amex 0002");
      expect(rows[1]).toHaveTextContent("−$48.08US$34.99");
    });
  });

  it("says there is nothing to review", async () => {
    inboxServer({ purchases: [] });
    renderApp("/receipts");
    expect(await screen.findByRole("heading", { name: "Nothing to review" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Your receipt email address" })).toHaveAttribute("href", "/settings/receipt-email");
  });
});

describe("Add", () => {
  it("adds the purchase with the suggested category, the card's account and the day's rate, then leaves the list", async () => {
    const server = inboxServer({
      ledger,
      purchases: [purchase(2, { merchant: "Steam", amount: 3499, currency: "USD", card: "Visa 0001", capturedAt: localNoon("2026-11-10") })],
      cards: [{ card: "VISA 0001", accountId: "visa" }],
      rates: rates(),
    });
    const user = userEvent.setup();
    renderApp("/receipts");
    await user.click(await within(await purchaseList()).findByRole("button", { name: /^Steam/ }));
    const sheet = await screen.findByRole("dialog", { name: "Purchase" });
    expect(within(sheet).getByLabelText("Title")).toHaveValue("Steam");
    expect(within(sheet).getByText("Suggested from your last Steam entry")).toBeInTheDocument();
    expect(within(sheet).getByRole("radio", { name: "Food & drinks" })).toBeChecked();
    await waitFor(() => {
      expect(within(sheet).getByText("From your Visa 0001 card")).toBeInTheDocument();
    });
    expect(await within(sheet).findByText("1 USD = 1.3742 CAD")).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: /Add expense/ }));
    await waitFor(() => {
      expect(server.inbox.resolutions).toHaveLength(1);
    });
    const added = server.inbox.resolutions[0]?.body as { outcome: string; entryId: string };
    expect(added.outcome).toBe("added");
    await waitFor(() => {
      expect(server.state.ledger.transactions.find((item) => item.id === added.entryId)).toMatchObject({
        title: "Steam",
        total: 4808,
        categoryId: "food",
        accountId: "visa",
        date: "2026-11-10",
        originalAmount: 3499,
        originalCurrency: "USD",
        rate: "1.3742",
      });
    });
    expect(await screen.findByRole("heading", { name: "Nothing to review" })).toBeInTheDocument();
  });

  it("adds it to a household, split equally and paid by you", async () => {
    const server = inboxServer({ ledger, purchases: [purchase(1, { merchant: "Metro", amount: 5418 })], shared: { id: "s1", householdId: "h1", title: "x", totalCents: 100, date: "2026-11-01", revision: 1 } });
    const created: unknown[] = [];
    const base = server.fetchMock.getMockImplementation();
    server.fetchMock.mockImplementation((input, init) => {
      if (input === "/api/auth/me") return Promise.resolve(json({ email: ALEX, userId: "u1" }));
      if (input === "/api/households/h1/expenses" && init?.method === "POST") {
        const body = JSON.parse(init.body as string) as { title: string; totalCents: number; category: object; date: string };
        created.push(body);
        const half = body.totalCents / 2;
        return Promise.resolve(
          json(
            {
              expense: {
                id: "new-expense",
                householdId: "h1",
                title: body.title,
                totalCents: body.totalCents,
                payerUserId: "u1",
                splitMode: "equal",
                category: body.category,
                note: "",
                date: body.date,
                splits: [{ userId: "u1", amountCents: Math.ceil(half) }, { userId: "u2", amountCents: Math.floor(half) }],
                revision: 1,
                createdBy: "u1",
                createdAt: 1,
                updatedBy: "u1",
                updatedAt: 1,
                payments: [],
                paymentsClosed: false,
              },
            },
            201,
          ),
        );
      }
      return base ? base(input, init) : Promise.resolve(json({}, 404));
    });
    const user = userEvent.setup();
    renderApp("/receipts");
    await user.click(await within(await purchaseList()).findByRole("button", { name: /^Metro/ }));
    const sheet = await screen.findByRole("dialog", { name: "Purchase" });
    await waitFor(() => {
      expect(within(sheet).getByRole("option", { name: "Maison" })).toBeInTheDocument();
    });
    await user.selectOptions(within(sheet).getByLabelText("Split"), "Maison");
    expect(within(sheet).getByText("$27.09")).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: /Add to Maison/ }));
    await waitFor(() => {
      expect(server.inbox.resolutions[0]?.body).toEqual({ outcome: "added", entryId: "new-expense", householdId: "h1" });
    });
    expect(created[0]).toMatchObject({ title: "Metro", totalCents: 5418, splitMode: "equal", category: { name: "Food & drinks" } });
  });
});

describe("triage", () => {
  it("discards with Undo", async () => {
    const server = inboxServer({ purchases: [purchase(1)] });
    const user = userEvent.setup();
    renderApp("/receipts");
    await user.click(await within(await purchaseList()).findByRole("button", { name: /^Shop 1/ }));
    const sheet = await screen.findByRole("dialog", { name: "Purchase" });
    await user.click(within(sheet).getByRole("button", { name: "Discard" }));
    expect(await screen.findByText("Purchase discarded")).toBeInTheDocument();
    expect(server.inbox.resolutions[0]?.body).toEqual({ outcome: "discarded" });
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(await purchaseList()).toHaveTextContent("Shop 1");
    expect(server.inbox.purchases?.[0]?.status).toBe("to_review");
  });

  it("attaches to an entry that is the same purchase, adding nothing new", async () => {
    const server = inboxServer({ ledger: { transactions: [entry("coffee", "Coffee", { total: 675, share: 675, date: "2026-11-12" })] }, purchases: [purchase(1, { merchant: "Mill St. Coffee", amount: 675 })] });
    const user = userEvent.setup();
    renderApp("/receipts");
    const list = await purchaseList();
    await waitFor(() => {
      expect(list).toHaveTextContent("Matches an entry");
    });
    const before = server.state.revision;
    await user.click(await within(list).findByRole("button", { name: /^Mill St. Coffee/ }));
    const dialog = await screen.findByRole("dialog", { name: "Mill St. Coffee" });
    expect(within(dialog).getByText("Looks like the same purchase")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Attach to Coffee" }));
    await waitFor(() => {
      expect(server.inbox.resolutions[0]?.body).toEqual({ outcome: "attached", entryId: "coffee" });
    });
    expect(server.state.revision).toBe(before);
  });

  it("adds all the purchases that match nothing, and keeps the rest", async () => {
    const server = inboxServer({
      ledger: { transactions: [entry("coffee", "Coffee", { total: 675, share: 675, date: "2026-11-12" })] },
      purchases: [purchase(1, { merchant: "Mill St. Coffee", amount: 675 }), purchase(2, { merchant: "Metro", amount: 5418 }), purchase(3, { merchant: "Bakery", amount: 450 })],
    });
    const user = userEvent.setup();
    renderApp("/receipts");
    await purchaseList();
    await user.click(await screen.findByRole("button", { name: "Add all" }));
    const dialog = await screen.findByRole("dialog", { name: "Add all purchases" });
    expect(within(dialog).getByText("Stays in the Inbox")).toBeInTheDocument();
    expect(within(dialog).getByText("$58.68")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Add 2 expenses" }));
    await waitFor(() => {
      expect(server.inbox.resolutions.map((item) => (item.body as { outcome: string }).outcome)).toEqual(["added", "added"]);
    });
    await waitFor(() => {
      expect(server.state.ledger.transactions.map((item) => item.title).sort()).toEqual(["Bakery", "Coffee", "Metro"]);
    });
    expect(await purchaseList()).toHaveTextContent("Mill St. Coffee");
  });
});
