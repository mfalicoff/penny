import { configure, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ATTACHED_TOAST_MS } from "../src/features/receiptInbox/model";
import { entry, setOnline } from "./fakes/ledgerServer";
import { ADDRESS, hex, inboxFile, inboxItem, inboxServer, localNoon } from "./fakes/inboxServer";
import { bodyOf, callsTo, renderApp, wasCalled } from "./render";

/**
 * Emailed receipts in the real app (MAZ-184): Settings › Receipt email, the inbox and its
 * keyboard, the attach sheet (Suggested, confirm notes, Attach, Undo), New expense, From inbox in
 * the entry form, the remove hint, and the offline state. Synthetic data only.
 */

configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  setOnline(true);
  vi.useRealTimers();
});

const sidebar = async () => (await screen.findAllByRole("complementary", { name: "Penny" }))[0] as HTMLElement;

describe("feature switch", () => {
  it("shows nothing when the server has emailed receipts off", async () => {
    const server = inboxServer({ enabled: false, items: [inboxItem(1)] });
    renderApp("/settings");
    await screen.findByRole("heading", { level: 1, name: "Settings" });
    await waitFor(() => {
      expect(wasCalled(server.fetchMock, "/api/receipt-email")).toBe(true);
    });
    expect(within(screen.getByRole("navigation", { name: "Settings sections" })).queryByRole("link", { name: "Receipt email" })).not.toBeInTheDocument();
    expect(within(await sidebar()).queryByText("Receipts to attach")).not.toBeInTheDocument();
    expect(server.fetchMock.mock.calls.some(([input]) => (input as string).startsWith("/api/receipt-inbox"))).toBe(false);
  });

  it("lists Receipt email in Settings, and Receipts to attach once an address exists", async () => {
    inboxServer({ items: [inboxItem(1), inboxItem(2)] });
    renderApp("/settings");
    expect(await within(await screen.findByRole("navigation", { name: "Settings sections" })).findByRole("link", { name: "Receipt email" })).toBeInTheDocument();
    expect(await within(await sidebar()).findByRole("link", { name: "Receipts to attach, 2 receipts to attach" })).toHaveAttribute("href", "/receipts?status=to_attach");
  });
});

describe("Settings › Receipt email", () => {
  it("creates an address when there is none", async () => {
    const server = inboxServer({ address: null });
    const user = userEvent.setup();
    renderApp("/settings/receipt-email");
    await user.click(await screen.findByRole("button", { name: "Create address" }));
    expect(await screen.findByLabelText("Your receipt address")).toHaveValue("r-nnnnnnnnnnnnnnnnnnn1@receipts.example");
    expect(callsTo(server.fetchMock, "/api/receipt-email").filter((init) => init?.method === "POST")).toHaveLength(1);
    expect(within(await sidebar()).getByRole("link", { name: "Receipts to attach" })).toBeInTheDocument();
  });

  it("shows the address with Copy, the expiry with Extend, and the how-to", async () => {
    const server = inboxServer();
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderApp("/settings/receipt-email");
    const field = await screen.findByLabelText("Your receipt address");
    expect(field).toHaveValue(ADDRESS.address);
    expect(field).toHaveClass("inbox-address");
    expect(screen.getByText(/Forward a receipt email to this address, or send a photo of a paper receipt to it\./)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(ADDRESS.address);
    expect(screen.getByText("Address copied.")).toBeInTheDocument();
    expect(screen.getByText("Works until January 30, 2027")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Extend" }));
    expect(await screen.findByText("Works until March 1, 2027")).toBeInTheDocument();
    expect(bodyOf(callsTo(server.fetchMock, "/api/receipt-email").find((init) => init?.method === "PATCH"))).toEqual({ extend: true });
  });

  it("asks before a new address and before turning off, with the documented words", async () => {
    const server = inboxServer();
    const user = userEvent.setup();
    renderApp("/settings/receipt-email");
    await user.click(await screen.findByRole("button", { name: "New address" }));
    let dialog = await screen.findByRole("dialog", { name: "Get a new address?" });
    expect(dialog).toHaveAccessibleDescription("Your current address stops working right away.");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(server.inbox.created).toBe(0);
    expect(screen.getByRole("button", { name: "New address" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "New address" }));
    dialog = await screen.findByRole("dialog", { name: "Get a new address?" });
    await user.click(within(dialog).getByRole("button", { name: "New address" }));
    expect(await screen.findByLabelText("Your receipt address")).toHaveValue("r-nnnnnnnnnnnnnnnnnnn1@receipts.example");

    await user.click(screen.getByRole("button", { name: "Turn off" }));
    dialog = await screen.findByRole("dialog", { name: "Turn off receipt email?" });
    expect(dialog).toHaveAccessibleDescription("Mail sent to this address will be refused. Receipts already in your inbox stay there.");
    await user.click(within(dialog).getByRole("button", { name: "Turn off" }));
    expect(await screen.findByRole("button", { name: "Create address" })).toBeInTheDocument();
    expect(callsTo(server.fetchMock, "/api/receipt-email").some((init) => init?.method === "DELETE")).toBe(true);
  });

  it("edits allowed senders, explains them, and shows the server's refusal", async () => {
    const server = inboxServer();
    const user = userEvent.setup();
    renderApp("/settings/receipt-email");
    const input = await screen.findByLabelText("Address or domain");
    expect(input).toHaveAccessibleDescription(/Only email that passes sender verification from these addresses reaches your inbox\. If you forward receipts, add the address you forward from\./);
    await user.type(input, "not an address{Enter}");
    expect(await screen.findByText("Enter an email address (you@example.com) or a domain (example.com).")).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, "Me@Mail.Example{Enter}");
    expect(await within(await screen.findByRole("list", { name: "Allowed senders" })).findByText("me@mail.example")).toBeInTheDocument();
    expect(bodyOf(callsTo(server.fetchMock, "/api/receipt-email").find((init) => init?.method === "PATCH"))).toEqual({ allowedSenders: ["me@mail.example"] });

    server.inbox.sendersError = "Each allowed sender must be an email address or a domain.";
    await user.type(input, "shop.example{Enter}");
    expect(await screen.findByText("Each allowed sender must be an email address or a domain.")).toBeInTheDocument();
    server.inbox.sendersError = null;
    await user.click(screen.getByRole("button", { name: "Remove me@mail.example" }));
    await waitFor(() => {
      expect(server.inbox.address?.allowedSenders).toEqual([]);
    });
  });
});

describe("the inbox", () => {
  const items = () => [
    inboxItem(1, { receivedAt: localNoon("2026-11-10"), subject: "Older order" }),
    inboxItem(2, {
      receivedAt: localNoon("2026-11-12"),
      from: `<img src=x onerror="alert(1)"> <evil@spam.example>`,
      subject: "<b>Your receipt</b> <script>alert(1)</script>",
      senderVerified: false,
      expiresAt: Date.now() + 2 * 86_400_000 - 60_000,
    }),
    inboxItem(3, { status: "attached", attachedAt: Date.now(), expiresAt: null, files: [inboxFile("e3", "email", "Email PDF", { linked: true })] }),
  ];

  it("lists To attach newest first as plain text, with the badge, file count and expiry", async () => {
    inboxServer({ items: items() });
    const { container } = renderApp("/receipts");
    const list = await screen.findByRole("list", { name: "Receipts to attach" });
    const rows = within(list).getAllByRole("button");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(`<img src=x onerror="alert(1)">`);
    expect(rows[0]).toHaveTextContent("<b>Your receipt</b> <script>alert(1)</script>");
    expect(rows[0]).toHaveTextContent("2 files · Deleted in 2 days");
    expect(within(rows[0] as HTMLElement).getByText("Sender not verified")).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent("Acme Store");
    expect(rows[1]).toHaveTextContent("Older order");
    expect(within(rows[1] as HTMLElement).queryByText("Sender not verified")).not.toBeInTheDocument();
    // Untrusted text never becomes markup.
    expect(container.querySelector("main img, main script, main b")).toBeNull();
  });

  it("filters to Attached through the URL", async () => {
    const server = inboxServer({ items: items() });
    const user = userEvent.setup();
    const { router } = renderApp("/receipts");
    await screen.findByRole("list", { name: "Receipts to attach" });
    await user.click(screen.getByRole("radio", { name: "Attached" }));
    expect(await screen.findByRole("list", { name: "Attached receipts" })).toHaveTextContent("Order 3");
    expect(router.state.location.search).toEqual({ status: "attached" });
    expect(server.fetchMock.mock.calls.some(([input]) => (input as string) === "/api/receipt-inbox?status=attached")).toBe(true);
  });

  it("opens a row with Enter and shows its files in order, Email first", async () => {
    inboxServer({ items: items() });
    const user = userEvent.setup();
    renderApp("/receipts");
    const list = await screen.findByRole("list", { name: "Receipts to attach" });
    within(list).getAllByRole("button")[1]?.focus();
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "Acme Store" });
    expect(dialog).toHaveAccessibleDescription("Older order");
    const files = within(within(dialog).getByRole("list", { name: "Files" })).getAllByRole("listitem");
    expect(files.map((file) => file.textContent)).toEqual([expect.stringContaining("Email PDFEmail · 2 KB"), expect.stringContaining("invoice-1.pdfPDF · 2 KB")]);
    await user.click(within(dialog).getByRole("button", { name: "Open invoice-1.pdf" }));
    expect(await screen.findByRole("dialog", { name: "invoice-1.pdf" })).toBeInTheDocument();
  });

  it("offers Discard on Delete, with the confirmation, and deletes only after it", async () => {
    const server = inboxServer({ items: items() });
    const user = userEvent.setup();
    renderApp("/receipts");
    const list = await screen.findByRole("list", { name: "Receipts to attach" });
    const row = within(list).getAllByRole("button")[1] as HTMLElement;
    row.focus();
    await user.keyboard("{Delete}");
    let dialog = await screen.findByRole("dialog", { name: "Discard this email?" });
    expect(dialog).toHaveAccessibleDescription("Its 2 files will be deleted. This can't be undone.");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(row).toHaveFocus();
    expect(callsTo(server.fetchMock, `/api/receipt-inbox/${hex(1)}`)).toHaveLength(0);

    await user.keyboard("{Delete}");
    dialog = await screen.findByRole("dialog", { name: "Discard this email?" });
    await user.click(within(dialog).getByRole("button", { name: "Discard" }));
    expect(await screen.findByText("Email discarded")).toBeInTheDocument();
    expect(callsTo(server.fetchMock, `/api/receipt-inbox/${hex(1)}`)[0]?.method).toBe("DELETE");
    await waitFor(() => {
      expect(within(screen.getByRole("list", { name: "Receipts to attach" })).getAllByRole("button")).toHaveLength(1);
    });
    // Focus moves to the row that took its place.
    await waitFor(() => {
      expect(within(screen.getByRole("list", { name: "Receipts to attach" })).getAllByRole("button")[0]).toHaveFocus();
    });
  });

  it("is read-only offline, with the connect hint, and the sidebar entry can't open", async () => {
    inboxServer({ items: items() });
    const user = userEvent.setup();
    renderApp("/receipts");
    const list = await screen.findByRole("list", { name: "Receipts to attach" });
    setOnline(false);
    expect(screen.getAllByText("Connect to the internet to attach receipts.").length).toBeGreaterThan(0);
    const entry = within(await sidebar()).getByRole("link", { name: /Connect to the internet to attach receipts/ });
    expect(entry).toHaveAttribute("aria-disabled", "true");
    expect(entry).not.toHaveAttribute("href");
    await user.click(within(list).getAllByRole("button")[1] as HTMLElement);
    const dialog = await screen.findByRole("dialog", { name: "Acme Store" });
    expect(within(dialog).getByRole("button", { name: "Attach to…" })).toHaveAttribute("aria-disabled", "true");
    expect(within(dialog).getByRole("button", { name: "Discard" })).toHaveAttribute("aria-disabled", "true");
    expect(within(dialog).getByRole("button", { name: "New expense" })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("the attach sheet", () => {
  const lunch = entry("lunch", "Lunch at Mill St.", { date: "2026-11-12" });
  const ledger = {
    transactions: [
      lunch,
      entry("bakery", "Bakery", { date: "2026-11-14" }),
      entry("old", "Too old", { date: "2026-11-01" }),
      entry("salary", "Salary", { kind: "income", categoryId: "salary", date: "2026-11-12" }),
      { ...entry("hasone", "Has a receipt", { date: "2026-11-12" }), receipt: { id: "kept", name: "kept.pdf", mime: "application/pdf", uri: "/api/receipts/kept" } },
    ],
  };

  async function openSheet() {
    const user = userEvent.setup();
    renderApp("/receipts");
    const list = await screen.findByRole("list", { name: "Receipts to attach" });
    await user.click(within(list).getAllByRole("button")[0] as HTMLElement);
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Attach to…" }));
    return user;
  }

  it("asks which file (attachment preselected), suggests by date, confirms, attaches, and undoes", async () => {
    const server = inboxServer({ ledger, items: [inboxItem(1, { senderVerified: false })] });
    const user = await openSheet();
    const fileStep = await screen.findByRole("dialog", { name: "Which file?" });
    expect(within(fileStep).getByRole("radio", { name: /invoice-1\.pdf/ })).toBeChecked();
    await user.click(within(fileStep).getByRole("button", { name: "Next" }));

    const entryStep = await screen.findByRole("dialog", { name: "Attach to…" });
    const suggested = await within(entryStep).findByRole("list", { name: "Suggested expenses" });
    expect(within(suggested).getAllByRole("button").map((button) => button.querySelector(".results__title")?.textContent)).toEqual(["Lunch at Mill St.", "Bakery"]);
    await user.click(within(suggested).getByRole("button", { name: /Lunch at Mill St\./ }));

    const confirm = await screen.findByRole("dialog", { name: "Attach receipt?" });
    expect(confirm).toHaveTextContent("Penny couldn't verify who sent this email. Check the receipt before attaching it.");
    expect(confirm).not.toHaveTextContent("will be able to see this receipt");
    expect(confirm).not.toHaveTextContent("This replaces");
    const attach = within(confirm).getByRole("button", { name: /^Attach invoice-1\.pdf to Lunch at Mill St\., \$12\.00, November 12$/ });
    expect(attach).toHaveFocus();
    await user.click(attach);

    expect(await screen.findByText("Receipt attached to Lunch at Mill St.")).toBeInTheDocument();
    await waitFor(() => {
      expect(server.state.ledger.transactions.find((item) => item.id === "lunch")).toMatchObject({ receipt: { id: "inv1", name: "invoice-1.pdf", uri: "/api/receipts/inv1" } });
    });
    await waitFor(() => {
      expect(server.inbox.items[0]?.status).toBe("partly_attached");
    });
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => {
      expect(server.state.ledger.transactions.find((item) => item.id === "lunch")).not.toHaveProperty("receipt");
    });
    expect(await screen.findByText("Receipt removed")).toBeInTheDocument();
    await waitFor(() => {
      expect(server.inbox.items[0]?.status).toBe("to_attach");
    });
  });

  it("skips the file step for one file and confirms with View entry (8 seconds: tests/toast.test.tsx)", async () => {
    inboxServer({ ledger, items: [inboxItem(1, { files: [inboxFile("only", "attachment", "only.pdf")] })] });
    const user = await openSheet();
    const entryStep = await screen.findByRole("dialog", { name: "Attach to…" });
    await user.click(within(await within(entryStep).findByRole("list", { name: "Suggested expenses" })).getByRole("button", { name: /Bakery/ }));
    await user.click(within(await screen.findByRole("dialog", { name: "Attach receipt?" })).getByRole("button", { name: /^Attach only\.pdf/ }));
    expect(await screen.findByText("Receipt attached to Bakery.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View entry" })).toBeInTheDocument();
    expect(ATTACHED_TOAST_MS).toBe(8000);
    await user.click(screen.getByRole("button", { name: "View entry" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Activity" })).toBeInTheDocument();
    });
  });

  it("finds an entry that has a receipt through Search and says what it replaces", async () => {
    inboxServer({
      ledger,
      items: [inboxItem(1, { files: [inboxFile("only", "attachment", "only.pdf")] })],
      search: (body) => (body.query === "has" ? [{ key: "personal:hasone", source: "personal", match: "title", entry: ledger.transactions[4] }] : []),
    });
    const user = await openSheet();
    const entryStep = await screen.findByRole("dialog", { name: "Attach to…" });
    expect(within(await within(entryStep).findByRole("list", { name: "Suggested expenses" })).queryByText("Has a receipt")).not.toBeInTheDocument();
    await user.type(within(entryStep).getByLabelText("Search expenses"), "has");
    await user.click(within(await within(entryStep).findByRole("list", { name: "Matching expenses" })).getByRole("button", { name: /Has a receipt/ }));
    const confirm = await screen.findByRole("dialog", { name: "Attach receipt?" });
    expect(confirm).toHaveTextContent("This replaces kept.pdf. The current receipt stays in Penny and can be attached again.");
    expect(confirm).not.toHaveTextContent("couldn't verify");
  });

  it("says who will see it on a shared expense, and asks again after a conflict", async () => {
    const shared = { id: "s1", householdId: "h1", title: "Groceries run", totalCents: 4000, date: "2026-11-11", revision: 2 };
    const server = inboxServer({
      ledger: { transactions: [] },
      shared,
      items: [inboxItem(1, { files: [inboxFile("only", "attachment", "only.pdf")] })],
      search: (body) =>
        body.source === "shared"
          ? [
              {
                key: "shared:s1",
                source: "shared",
                match: null,
                entry: { id: "s1", householdId: "h1", householdName: "Maison", householdCurrency: "CAD", title: "Groceries run", date: "2026-11-11", totalCents: 4000, shareCents: 2000, payerUserId: "u1", category: { name: "Groceries", icon: "basket-outline", color: "#6C9C79" }, note: "" },
              },
            ]
          : [],
    });
    server.inbox.sharedConflicts = 1;
    const user = await openSheet();
    const entryStep = await screen.findByRole("dialog", { name: "Attach to…" });
    const suggested = await within(entryStep).findByRole("list", { name: "Suggested expenses" });
    expect(suggested).toHaveTextContent("Shared · Maison");
    await user.click(within(suggested).getByRole("button", { name: /Groceries run/ }));
    let confirm = await screen.findByRole("dialog", { name: "Attach receipt?" });
    expect(await within(confirm).findByText("Members of Maison will be able to see this receipt.")).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: /^Attach only\.pdf to Groceries run/ }));
    confirm = await screen.findByRole("dialog", { name: "Attach receipt?" });
    expect(await within(confirm).findByText("This expense just changed")).toBeInTheDocument();
    expect(await within(confirm).findByText("Groceries run (edited)")).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: /^Attach only\.pdf to Groceries run \(edited\)/ }));
    expect(await screen.findByText("Receipt attached to Groceries run (edited).")).toBeInTheDocument();
    const puts = callsTo(server.fetchMock, "/api/households/h1/expenses/s1").filter((init) => init?.method === "PUT");
    expect(bodyOf(puts.at(-1))).toMatchObject({ receiptId: "only", revision: 3 });
  });

  it("starts New expense with the received day, the sender's name and the receipt", async () => {
    inboxServer({ ledger, items: [inboxItem(1)] });
    const user = userEvent.setup();
    renderApp("/receipts");
    const list = await screen.findByRole("list", { name: "Receipts to attach" });
    await user.click(within(list).getAllByRole("button")[0] as HTMLElement);
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "New expense" }));
    const form = await screen.findByRole("form", { name: "Add entry" });
    expect(within(form).getByLabelText("Title")).toHaveValue("Acme Store");
    expect(within(form).getByLabelText("Amount (CAD)")).toHaveValue("");
    expect(within(form).getByLabelText("Date")).toHaveValue("2026-11-12");
    await user.click(within(form).getByRole("button", { name: /More details/ }));
    expect(within(within(form).getByRole("group", { name: "Receipt" })).getByText("invoice-1.pdf")).toBeInTheDocument();
  });
});

describe("From inbox in the entry form", () => {
  it("picks an emailed receipt into the draft and saves it with the entry", async () => {
    const server = inboxServer({ items: [inboxItem(1)] });
    const user = userEvent.setup();
    renderApp("/transactions");
    await screen.findByRole("heading", { level: 1 });
    await within(await sidebar()).findByRole("link", { name: "Receipts to attach, 1 receipt to attach" });
    await user.keyboard("n");
    const form = await screen.findByRole("form", { name: "Add entry" });
    await user.type(within(form).getByLabelText("Amount (CAD)"), "12");
    await user.type(within(form).getByLabelText("Title"), "Supplies");
    await user.click(within(form).getByRole("button", { name: /More details/ }));
    const group = within(form).getByRole("group", { name: "Receipt" });
    await user.click(within(group).getByRole("button", { name: "Attach a receipt from your inbox" }));
    const picker = await screen.findByRole("dialog", { name: "Choose a receipt from your inbox" });
    await user.click(within(picker).getByRole("button", { name: "Use invoice-1.pdf from Acme Store" }));
    expect(await within(group).findByText("invoice-1.pdf")).toBeInTheDocument();
    await user.click(within(screen.getByRole("dialog", { name: "Add entry" })).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(server.state.ledger.transactions.find((item) => item.title === "Supplies")).toMatchObject({ receipt: { id: "inv1", name: "invoice-1.pdf" } });
    });
    // No upload: the file is already on the server.
    expect(callsTo(server.fetchMock, "/api/receipts")).toHaveLength(0);
  });

  it("says a removed emailed receipt goes back to the inbox", async () => {
    const receipt = { id: "inv1", name: "invoice-1.pdf", mime: "application/pdf", uri: "/api/receipts/inv1" };
    const item = inboxItem(1, { status: "partly_attached", files: [inboxFile("email1", "email", "Email PDF"), inboxFile("inv1", "attachment", "invoice-1.pdf", { linked: true })] });
    inboxServer({ ledger: { transactions: [{ ...entry("e1", "Dinner"), receipt } as never] }, items: [item], search: () => [] });
    const user = userEvent.setup();
    renderApp("/settings");
    await within(await sidebar()).findByRole("link", { name: "Receipts to attach, 1 receipt to attach" });
    await user.keyboard("n");
    const form = await screen.findByRole("form", { name: "Add entry" });
    await user.click(within(form).getByRole("button", { name: /More details/ }));
    const group = within(form).getByRole("group", { name: "Receipt" });
    await user.click(within(group).getByRole("button", { name: "Attach a receipt from your inbox" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Choose a receipt from your inbox" })).getByRole("button", { name: "Use Email PDF from Acme Store" }));
    await within(group).findByText("Email PDF");
    await user.click(within(group).getByRole("button", { name: "Remove Email PDF" }));
    expect(group).toHaveAccessibleDescription(/The receipt goes back to your inbox\./);
  });

  it("is hidden when the inbox is empty and disabled offline", async () => {
    inboxServer({ items: [inboxItem(1)] });
    const user = userEvent.setup();
    renderApp("/transactions");
    await within(await sidebar()).findByRole("link", { name: "Receipts to attach, 1 receipt to attach" });
    await user.keyboard("n");
    const form = await screen.findByRole("form", { name: "Add entry" });
    await user.click(within(form).getByRole("button", { name: /More details/ }));
    const group = within(form).getByRole("group", { name: "Receipt" });
    setOnline(false);
    expect(within(group).getByRole("button", { name: "Attach a receipt from your inbox" })).toHaveAttribute("aria-disabled", "true");
    expect(group).toHaveAccessibleDescription(/Connect to the internet to attach a receipt/);
  });
});

describe("partly attached items", () => {
  it("shows 1 of 2 attached and finishes with Done after the same confirmation", async () => {
    const item = inboxItem(1, { status: "partly_attached", files: [inboxFile("email1", "email", "Email PDF"), inboxFile("inv1", "attachment", "invoice-1.pdf", { linked: true })] });
    const server = inboxServer({ items: [item] });
    const user = userEvent.setup();
    renderApp("/receipts");
    const list = await screen.findByRole("list", { name: "Receipts to attach" });
    expect(list).toHaveTextContent("1 of 2 attached");
    await user.click(within(list).getAllByRole("button")[0] as HTMLElement);
    const detail = await screen.findByRole("dialog", { name: "Acme Store" });
    expect(within(detail).getByRole("list", { name: "Files" })).toHaveTextContent("Attached");
    await user.click(within(detail).getByRole("button", { name: "Done" }));
    const confirm = await screen.findByRole("dialog", { name: "Finish this email?" });
    expect(confirm).toHaveAccessibleDescription("Done discards the files you haven't attached. Its 1 file will be deleted. This can't be undone. 1 file attached to an entry is kept.");
    await user.click(within(confirm).getByRole("button", { name: "Done" }));
    expect(await screen.findByText("Moved to Attached")).toBeInTheDocument();
    expect(callsTo(server.fetchMock, `/api/receipt-inbox/${hex(1)}/done`)[0]?.method).toBe("POST");
  });
});
