import { onlineManager } from "@tanstack/react-query";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Category, Ledger, PaymentAccount } from "@domain/ledger.ts";
import { HOUSEHOLD_LINK_MESSAGE } from "../src/features/organize/model";
import { MemoryLedgerDatabase, StorageError } from "../src/offline/database";
import { offlineDependencies } from "../src/offline/OfflineLedgerProvider";
import { createHouseholdServer } from "./fakes/householdServer";
import { ALEX, bodyOf, callsTo, emptyWireLedger, json, renderApp, stubServer } from "./render";

/**
 * Accounts and categories (MAZ-89) in the real app over the durable offline ledger (IndexedDB
 * through fake-indexeddb) and a revision-checked `/api/ledger` that applies the server's
 * household-link rule. Synthetic data only.
 */

const entry = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: `Entry ${id}`, kind: "expense", total: 1200, share: 1200, categoryId: "groceries", date: "2026-11-02", note: "", ...extra });
const rule = (id: string, extra: Record<string, unknown> = {}) => ({ ...entry(id), frequency: "monthly", nextDate: "2099-12-01", anchorDay: 1, active: true, ...extra });

const chequing: PaymentAccount = { id: "acct-chq", name: "Main chequing", type: "bank" };
const visa: PaymentAccount = { id: "acct-visa", name: "Visa", type: "credit" };
const savings: PaymentAccount = { id: "acct-sav", name: "Savings", type: "bank" };

type WireLedger = Omit<Ledger, "transactions" | "recurring"> & { transactions: object[]; recurring: object[] };

/** `GET`/`PUT /api/ledger` with revision checks; `linked` accounts are ones a shared expense you paid uses. */
function ledgerServer(initial: Partial<WireLedger> = {}, options: { linked?: string[] } = {}) {
  const state = {
    revision: 3,
    ledger: { ...emptyWireLedger(), ...initial } as unknown as WireLedger,
    down: false,
    puts: [] as WireLedger[],
  };
  const handle = (init: RequestInit | undefined) => {
    if (state.down) throw new TypeError("Failed to fetch");
    if (init?.method === "PUT") {
      const body = bodyOf(init) as { revision: number; ledger: WireLedger };
      const kept = new Set(body.ledger.accounts.map((account) => account.id));
      if ((options.linked ?? []).some((id) => state.ledger.accounts.some((account) => account.id === id) && !kept.has(id)))
        return json({ error: HOUSEHOLD_LINK_MESSAGE }, 400);
      if (body.revision !== state.revision) return json({ error: "Your data changed on another device. Please refresh and try again." }, 409);
      state.revision += 1;
      state.ledger = body.ledger;
      state.puts.push(body.ledger);
    }
    return json({ revision: state.revision, ledger: state.ledger });
  };
  const fetchMock = stubServer((url, init) => (url === "/api/ledger" ? handle(init) : undefined));
  return { state, fetchMock, handle };
}

function setOnline(value: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(value);
  act(() => {
    window.dispatchEvent(new Event(value ? "online" : "offline"));
  });
}

const dialog = (name: string | RegExp) => screen.findByRole("dialog", { name });
const synced = (server: ReturnType<typeof ledgerServer>, count: number) =>
  waitFor(() => {
    expect(server.state.puts.length).toBe(count);
  });

async function addAccount(user: UserEvent, name: string, type: string) {
  await user.click(screen.getByRole("button", { name: "Add account" }));
  const form = await dialog("New account");
  await user.type(within(form).getByLabelText("Name"), name);
  await user.click(within(form).getByRole("radio", { name: type }));
  await user.click(within(form).getByRole("button", { name: "Add account" }));
  await waitFor(() => {
    expect(screen.queryByRole("dialog", { name: "New account" })).not.toBeInTheDocument();
  });
}

const originalDependencies = offlineDependencies.current;

afterEach(() => {
  offlineDependencies.current = originalDependencies;
  onlineManager.setOnline(true);
  vi.useRealTimers();
});

describe("payment accounts", { timeout: 20_000 }, () => {
  it("starts empty, adds every type, and lists type and usage without balances", async () => {
    const server = ledgerServer();
    const user = userEvent.setup();
    renderApp("/accounts");
    expect(await screen.findByRole("heading", { level: 1, name: "Accounts" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Where your money lives" })).toBeInTheDocument();

    const types = [
      ["Everyday chequing", "Bank account", "bank"],
      ["Rewards card", "Credit card", "credit"],
      ["Wallet", "Cash", "cash"],
      ["Gift card", "Other", "other"],
    ] as const;
    for (const [name, label] of types) await addAccount(user, name, label);
    await waitFor(() => {
      expect(server.state.ledger.accounts.map(({ name, type }) => ({ name, type }))).toEqual(types.map(([name, , type]) => ({ name, type })));
    });
    expect(screen.getByRole("button", { name: "Edit Rewards card" })).toHaveAccessibleDescription("Credit card · not used yet");
    expect(screen.getByText(/Penny never connects to your bank and doesn't track balances/)).toBeInTheDocument();
    expect(document.querySelector(".money")).toBeNull();
  });

  it("renames an in-use account (links stay), refuses duplicates and empty names, and keeps it until its links move", async () => {
    const server = ledgerServer({
      accounts: [chequing, visa],
      transactions: [entry("e1", { accountId: visa.id }), entry("e2", { accountId: visa.id })],
      recurring: [rule("r1", { accountId: visa.id })],
    });
    const user = userEvent.setup();
    renderApp("/accounts");
    const row = await screen.findByRole("button", { name: "Edit Visa" });
    expect(row).toHaveAccessibleDescription("Credit card · 2 entries, 1 schedule");
    expect(screen.getByRole("button", { name: "Edit Main chequing" })).toHaveAccessibleDescription("Bank account · not used yet");

    await user.click(row);
    const form = await dialog("Edit account");
    const name = within(form).getByLabelText("Name");
    expect(name).toHaveFocus();
    await user.clear(name);
    await user.click(within(form).getByRole("button", { name: "Save" }));
    expect(await within(form).findByText("Give your account a name.")).toBeInTheDocument();
    expect(name).toHaveFocus();
    await user.type(name, "main CHEQUING ");
    await user.click(within(form).getByRole("button", { name: "Save" }));
    expect(await within(form).findByText("You already have an account with this name.")).toBeInTheDocument();
    expect(name).toHaveAttribute("aria-invalid", "true");

    // In use: explained, and only removable by moving the links.
    expect(within(form).getByText(/Visa is used by 2 entries and 1 schedule\. Move them to another account to remove it\./)).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "Move and remove" })).toBeDisabled();

    await user.clear(name);
    await user.type(name, "Travel card");
    await user.click(within(form).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Account saved")).toBeInTheDocument();
    await synced(server, 1);
    expect(server.state.ledger.accounts).toContainEqual({ ...visa, name: "Travel card" });
    expect(server.state.ledger.transactions).toEqual([entry("e1", { accountId: visa.id }), entry("e2", { accountId: visa.id })]);
    expect(await screen.findByRole("button", { name: "Edit Travel card" })).toBeInTheDocument();
  });

  it("moves entries and schedules to another account and removes it, and Undo puts every link back", async () => {
    const server = ledgerServer({
      accounts: [chequing, visa],
      transactions: [entry("e1", { accountId: visa.id }), entry("e2", { accountId: chequing.id })],
      recurring: [rule("r1", { accountId: visa.id })],
    });
    const user = userEvent.setup();
    renderApp("/accounts");
    await user.click(await screen.findByRole("button", { name: "Edit Visa" }));
    const form = await dialog("Edit account");
    await user.selectOptions(within(form).getByLabelText("Move them to"), "Main chequing");
    await user.click(within(form).getByRole("button", { name: "Move and remove" }));
    expect(await screen.findByText("Visa removed")).toBeInTheDocument();
    expect(screen.getByText("Its 1 entry and 1 schedule now use Main chequing.")).toBeInTheDocument();
    await synced(server, 1);
    expect(server.state.ledger.accounts).toEqual([chequing]);
    expect(server.state.ledger.transactions.map((item) => (item as { accountId: string }).accountId)).toEqual([chequing.id, chequing.id]);
    expect((server.state.ledger.recurring[0] as { accountId: string }).accountId).toBe(chequing.id);
    expect(await screen.findByRole("button", { name: "Edit Main chequing" })).toHaveAccessibleDescription("Bank account · 2 entries, 1 schedule");

    await user.click(screen.getByRole("button", { name: "Undo" }));
    await synced(server, 2);
    expect(server.state.ledger.accounts).toEqual([chequing, visa]);
    expect(server.state.ledger.transactions).toEqual([entry("e1", { accountId: visa.id }), entry("e2", { accountId: chequing.id })]);
    expect((server.state.ledger.recurring[0] as { accountId: string }).accountId).toBe(visa.id);
  });

  it("removes an unused account right away, with Undo", async () => {
    const server = ledgerServer({ accounts: [chequing, savings] });
    const user = userEvent.setup();
    renderApp("/accounts");
    await user.click(await screen.findByRole("button", { name: "Edit Savings" }));
    const form = await dialog("Edit account");
    expect(within(form).getByText(/Nothing uses Savings/)).toBeInTheDocument();
    await user.click(within(form).getByRole("button", { name: "Remove account" }));
    expect(await screen.findByText("Account removed")).toBeInTheDocument();
    await synced(server, 1);
    expect(server.state.ledger.accounts).toEqual([chequing]);
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await synced(server, 2);
    expect(server.state.ledger.accounts).toEqual([chequing, savings]);
  });

  it("saves offline in this browser, marks it waiting to sync, and syncs once on reconnect", async () => {
    const server = ledgerServer({ accounts: [chequing] });
    const user = userEvent.setup();
    renderApp("/accounts");
    await screen.findByRole("button", { name: "Edit Main chequing" });
    server.state.down = true;
    setOnline(false);
    await addAccount(user, "Cash jar", "Cash");
    expect(await screen.findByText("Saved on this device. It syncs when you're back online.")).toBeInTheDocument();
    const row = await screen.findByRole("button", { name: "Edit Cash jar" });
    expect(row).toHaveAccessibleDescription("Cash · not used yet Waiting to sync");
    expect(within(row).getByText("Waiting to sync")).toBeInTheDocument();
    expect(await screen.findByText("Offline · 1 change waiting")).toBeInTheDocument();

    server.state.down = false;
    setOnline(true);
    await synced(server, 1);
    expect(server.state.ledger.accounts.map((account) => account.name)).toEqual(["Main chequing", "Cash jar"]);
    await waitFor(() => {
      expect(within(screen.getByRole("button", { name: "Edit Cash jar" })).queryByText("Waiting to sync")).not.toBeInTheDocument();
    });
  });

  it("keeps the draft when the browser can't save, and Retry saves it", async () => {
    const db = new MemoryLedgerDatabase();
    offlineDependencies.current = { ...originalDependencies, openDatabase: () => Promise.resolve(db) };
    const server = ledgerServer({ accounts: [chequing] });
    const user = userEvent.setup();
    renderApp("/accounts");
    await screen.findByRole("button", { name: "Edit Main chequing" });
    await user.click(screen.getByRole("button", { name: "Add account" }));
    const form = await dialog("New account");
    await user.type(within(form).getByLabelText("Name"), "Wallet");
    db.failWith = new StorageError("quota");
    await user.click(within(form).getByRole("button", { name: "Add account" }));
    const alert = await within(form).findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't save");
    expect(alert).toHaveTextContent("out of storage space");
    expect(within(form).getByLabelText("Name")).toHaveValue("Wallet");

    db.failWith = null;
    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Wallet added")).toBeInTheDocument();
    await synced(server, 1);
    expect(server.state.ledger.accounts.map((account) => account.name)).toEqual(["Main chequing", "Wallet"]);
  });

  it("puts back an account the server keeps because a shared expense links it, so the rest syncs", async () => {
    const server = ledgerServer({ accounts: [chequing, visa] }, { linked: [visa.id] });
    const user = userEvent.setup();
    renderApp("/accounts");
    await user.click(await screen.findByRole("button", { name: "Edit Visa" }));
    await user.click(within(await dialog("Edit account")).getByRole("button", { name: "Remove account" }));
    await addAccount(user, "Wallet", "Cash");

    const banner = (await screen.findByText("Visa can't be removed yet")).closest(".pk-banner") as HTMLElement;
    expect(banner).toHaveTextContent("A shared expense or repeating shared expense you paid is linked to it");
    expect(server.state.puts).toEqual([]);
    await user.click(within(banner).getByRole("button", { name: "Put it back" }));
    await synced(server, 1);
    // The merge keeps the server's order and adds this browser's new account after it.
    expect(server.state.ledger.accounts.map((account) => account.name)).toEqual(["Main chequing", "Visa", "Wallet"]);
    await waitFor(() => {
      expect(screen.queryByText("Visa can't be removed yet")).not.toBeInTheDocument();
    });
  });

  it("closes with Escape and returns focus to the row that opened it", async () => {
    ledgerServer({ accounts: [chequing] });
    const user = userEvent.setup();
    renderApp("/accounts");
    const row = await screen.findByRole("button", { name: "Edit Main chequing" });
    row.focus();
    await user.keyboard("{Enter}");
    expect(within(await dialog("Edit account")).getByLabelText("Name")).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(row).toHaveFocus();
  });
});

describe("categories", { timeout: 20_000 }, () => {
  const coffee: Category = { id: "c-coffee", name: "Coffee", icon: "cafe-outline", color: "#E0529C", kind: "expense" };
  const legacy: Category = { id: "groceries", name: "Groceries", icon: "basket-outline", color: "#6C9C79", kind: "expense" };

  it("lists each kind from the URL and adds a category of every kind with a palette color and icon", async () => {
    const server = ledgerServer({ categories: [legacy, coffee], transactions: [entry("e1"), entry("e2")], recurring: [rule("r1")] });
    const user = userEvent.setup();
    const { router } = renderApp("/categories");
    expect(await screen.findByRole("button", { name: "Edit Groceries" })).toHaveAccessibleDescription("2 entries, 1 schedule");
    expect(screen.getByRole("heading", { name: "2 expense categories" })).toBeInTheDocument();

    for (const [kind, label] of [["income", "Income"], ["investment", "Investment"], ["expense", "Expense"]] as const) {
      await user.click(screen.getByRole("radio", { name: label }));
      await waitFor(() => {
        expect(router.state.location.search).toEqual(kind === "expense" ? {} : { kind });
      });
      await user.click(screen.getByRole("button", { name: "New category" }));
      const form = await dialog("New category");
      expect(within(form).getByRole("radio", { name: label })).toBeChecked();
      await user.type(within(form).getByLabelText("Name"), `${label} things`);
      await user.click(within(form).getByRole("radio", { name: "Teal" }));
      await user.click(within(form).getByRole("radio", { name: "Airplane" }));
      await user.click(within(form).getByRole("button", { name: "Add category" }));
      expect(await screen.findByRole("button", { name: `Edit ${label} things` })).toHaveAccessibleDescription(/not used yet/);
    }
    await waitFor(() => {
      expect(server.state.ledger.categories.slice(2).map(({ name, kind, color, icon }) => ({ name, kind, color, icon }))).toEqual([
        { name: "Income things", kind: "income", color: "#0FA3A3", icon: "airplane-outline" },
        { name: "Investment things", kind: "investment", color: "#0FA3A3", icon: "airplane-outline" },
        { name: "Expense things", kind: "expense", color: "#0FA3A3", icon: "airplane-outline" },
      ]);
    });

    // A same-named category is fine in another kind, not in the same one.
    await user.click(screen.getByRole("button", { name: "New category" }));
    const form = await dialog("New category");
    await user.type(within(form).getByLabelText("Name"), "coffee");
    await user.click(within(form).getByRole("button", { name: "Add category" }));
    expect(await within(form).findByText("You already have an expense category with this name.")).toBeInTheDocument();
  });

  it("keeps an in-use category's kind and legacy color, renames it, and moves its entries before removing it", async () => {
    const server = ledgerServer({ categories: [legacy, coffee], transactions: [entry("e1"), entry("e2", { categoryId: coffee.id })], recurring: [rule("r1")] });
    const user = userEvent.setup();
    renderApp("/categories");
    await user.click(await screen.findByRole("button", { name: "Edit Groceries" }));
    const form = await dialog("Edit category");
    expect(within(form).getByRole("radio", { name: "Income" })).toBeDisabled();
    expect(within(form).getByText("Entries use this category, so it stays an expense category.")).toBeInTheDocument();
    // A color from an older app stays selected; the palette is offered next to it.
    expect(within(form).getByRole("radio", { name: "Current color" })).toBeChecked();
    await user.clear(within(form).getByLabelText("Name"));
    await user.type(within(form).getByLabelText("Name"), "Groceries & dining");
    await user.click(within(form).getByRole("button", { name: "Save" }));
    await synced(server, 1);
    expect(server.state.ledger.categories[0]).toEqual({ ...legacy, name: "Groceries & dining" });

    await user.click(await screen.findByRole("button", { name: "Edit Groceries & dining" }));
    const again = await dialog("Edit category");
    expect(within(again).getByText(/is used by 1 entry and 1 schedule/)).toBeInTheDocument();
    await user.selectOptions(within(again).getByLabelText("Move them to"), "Coffee");
    await user.click(within(again).getByRole("button", { name: "Move and remove" }));
    await synced(server, 2);
    expect(server.state.ledger.categories).toEqual([coffee]);
    expect(server.state.ledger.transactions.map((item) => (item as { categoryId: string }).categoryId)).toEqual([coffee.id, coffee.id]);
    expect(await screen.findByRole("button", { name: "Edit Coffee" })).toHaveAccessibleDescription("2 entries, 1 schedule");
  });

  it("falls back to expenses for an unknown kind in the URL", async () => {
    ledgerServer({ categories: [legacy] });
    renderApp("/categories?kind=savings");
    expect(await screen.findByRole("button", { name: "Edit Groceries" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Expense" })).toBeChecked();
  });
});

describe("inline creation from an entry form", { timeout: 20_000 }, () => {
  it("adds a category from the shared expense form by keyboard and returns to the same draft", async () => {
    // A household created in September, as in tests/households.test.tsx, so October is a member day.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-01T12:00:00Z"));
    const households = createHouseholdServer();
    const created = households.handle(ALEX, "POST", "/api/households", { name: "Maison", currency: "CAD" }).body as { household: { id: string } };
    const id = created.household.id;
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    const ledger = ledgerServer({ categories: [{ id: "groceries", name: "Groceries", icon: "basket-outline", color: "#6C9C79", kind: "expense" }] });
    const fetchMock = stubServer((url, init) => {
      if (url === "/api/ledger") return ledger.handle(init);
      if (!url.startsWith("/api/households")) return undefined;
      const result = households.handle(ALEX, init?.method ?? "GET", url, (bodyOf(init) ?? {}) as Record<string, unknown>);
      return json(result.body, result.status);
    });
    const user = userEvent.setup();
    renderApp(`/households/${id}`);
    await user.click(await screen.findByRole("button", { name: "Shared expense" }));
    const form = await dialog("New shared expense");
    await user.type(within(form).getByLabelText("Title"), "Vet visit");
    await user.type(within(form).getByLabelText(/^Total/), "60");
    await user.clear(within(form).getByLabelText("Date"));
    await user.type(within(form).getByLabelText("Date"), "2026-10-05");

    const opener = within(form).getByRole("button", { name: "New category" });
    opener.focus();
    await user.keyboard("{Enter}");
    const inner = await dialog("New expense category");
    expect(within(inner).getByLabelText("Name")).toHaveFocus();
    expect(within(inner).queryByRole("radio", { name: "Income" })).not.toBeInTheDocument();
    // Escape closes only the inner dialog; the draft is untouched.
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "New expense category" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("dialog", { name: "New shared expense" })).toBeInTheDocument();
    expect(opener).toHaveFocus();

    await user.keyboard("{Enter}");
    const again = await dialog("New expense category");
    await user.keyboard("Pets");
    // Tab stays inside the inner dialog.
    for (let step = 0; step < 40; step += 1) {
      await user.tab();
      expect(again.contains(document.activeElement)).toBe(true);
    }
    await user.click(within(again).getByRole("button", { name: "Add category" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "New expense category" })).not.toBeInTheDocument();
    });
    expect(within(form).getByLabelText("Category")).toHaveDisplayValue("Pets");
    expect(within(form).getByLabelText("Title")).toHaveValue("Vet visit");
    expect(within(form).getByLabelText(/^Total/)).toHaveValue("60");
    await synced(ledger, 1);
    expect(ledger.state.ledger.categories.map((category) => category.name)).toEqual(["Groceries", "Pets"]);

    await user.click(within(form).getByRole("button", { name: "Add expense" }));
    expect(await screen.findByText("Vet visit added")).toBeInTheDocument();
    const post = callsTo(fetchMock, `/api/households/${id}/expenses`).find((init) => init?.method === "POST");
    expect(bodyOf(post)).toMatchObject({ title: "Vet visit", category: { name: "Pets", icon: "pricetag-outline", color: "#3B82F6" } });
  });
});

describe("in the demo", { timeout: 20_000 }, () => {
  it("adds an account to the in-memory ledger without calling the API", async () => {
    const fetchMock = stubServer((url) => (url === "/api/auth/me" ? json({ error: "Please sign in to continue." }, 401) : undefined));
    const user = userEvent.setup();
    renderApp("/accounts");
    await user.click(await screen.findByRole("button", { name: "Explore a demo" }));
    expect(await screen.findByRole("heading", { name: "Where your money lives" })).toBeInTheDocument();
    const calls = fetchMock.mock.calls.length;
    await addAccount(user, "Demo card", "Credit card");
    expect(await screen.findByRole("button", { name: "Edit Demo card" })).toHaveAccessibleDescription("Credit card · not used yet");
    expect(fetchMock.mock.calls.length).toBe(calls);
  });
});
