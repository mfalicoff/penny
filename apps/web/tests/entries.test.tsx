import { onlineManager } from "@tanstack/react-query";
import { act, configure, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openIndexedDb } from "../src/offline/database";
import { accountScope, recordKey, type LedgerRecord } from "../src/offline/record";
import { entry, ledgerServer, personalHit, setOnline, type WireEntry } from "./fakes/ledgerServer";
import { ALEX, json, renderApp, stubServer } from "./render";

/**
 * The personal entry form (MAZ-88) inside the real app (router, Query, AuthGate, the durable
 * offline store over fake IndexedDB). Every save goes through the offline store and syncs with a
 * revision-checked fake `PUT /api/ledger`. Synthetic data only.
 */

// Real IndexedDB transactions (fake-indexeddb) and a sync per save make these slower than other component tests.
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  localStorage.clear();
  onlineManager.setOnline(true);
});

async function stored(): Promise<LedgerRecord | undefined> {
  const db = await openIndexedDb();
  const value = (await db.get(recordKey(accountScope(window.location.origin, ALEX)))) as LedgerRecord | undefined;
  db.close();
  return value;
}

/** Opens Add entry with N and waits for the form (the ledger has loaded). */
async function openAdd(user: UserEvent) {
  await screen.findByRole("heading", { level: 1 });
  await user.keyboard("n");
  return screen.findByRole("form", { name: "Add entry" });
}

const dialog = () => screen.getByRole("dialog", { name: /Add entry|Edit entry/ });
const save = (user: UserEvent) => user.click(within(dialog()).getByRole("button", { name: "Save" }));

async function fill(user: UserEvent, form: HTMLElement, values: { amount?: string; title?: string; date?: string }) {
  if (values.amount !== undefined) {
    await user.clear(within(form).getByLabelText("Amount (CAD)"));
    await user.type(within(form).getByLabelText("Amount (CAD)"), values.amount);
  }
  if (values.title !== undefined) {
    await user.clear(within(form).getByLabelText("Title"));
    await user.type(within(form).getByLabelText("Title"), values.title);
  }
  if (values.date !== undefined) {
    await user.clear(within(form).getByLabelText("Date"));
    await user.type(within(form).getByLabelText("Date"), values.date);
  }
}

const serverEntries = (server: ReturnType<typeof ledgerServer>) => server.state.ledger.transactions;

describe("adding entries", () => {
  it("adds a split expense through the offline store, syncs it, and confirms with a toast", async () => {
    const server = ledgerServer();
    const user = userEvent.setup();
    renderApp("/");
    const form = await openAdd(user);
    expect(within(form).getByLabelText("Amount (CAD)")).toHaveFocus();
    await fill(user, form, { amount: "84.20", title: "Dinner at Bar Isabel", date: "2026-11-04" });
    await user.click(within(form).getByRole("radio", { name: "Food & drinks" }));
    await user.selectOptions(within(form).getByLabelText("Account"), "Chequing");

    await user.click(within(form).getByRole("button", { name: /More details/ }));
    await user.click(within(form).getByRole("radio", { name: "Percent" }));
    await user.clear(within(form).getByLabelText("Your percentage"));
    await user.type(within(form).getByLabelText("Your percentage"), "50");
    expect(within(form).getByText("Your share · counts in your spending").parentElement).toHaveTextContent("$42.10");
    await user.selectOptions(within(form).getByLabelText("Trip"), "Lisbon");
    await user.type(within(form).getByLabelText("Note"), "Birthday");
    await save(user);

    expect(await screen.findByText("Expense added")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(serverEntries(server)).toHaveLength(1);
    });
    expect(serverEntries(server)[0]).toMatchObject({
      title: "Dinner at Bar Isabel",
      kind: "expense",
      total: 8420,
      share: 4210,
      categoryId: "food",
      accountId: "chq",
      tripId: "lis",
      date: "2026-11-04",
      note: "Birthday",
    });
    expect((await stored())?.local.transactions).toHaveLength(1);
  });

  it("adds income at its full amount and offers income categories, without trips or splits", async () => {
    const server = ledgerServer();
    const user = userEvent.setup();
    renderApp("/");
    const form = await openAdd(user);
    await user.click(within(form).getByRole("radio", { name: "Income" }));
    expect(within(form).getByRole("radio", { name: "Salary" })).toBeChecked();
    expect(within(form).queryByRole("radio", { name: "Groceries" })).not.toBeInTheDocument();
    await user.click(within(form).getByRole("button", { name: /More details/ }));
    expect(within(form).queryByLabelText("Trip")).not.toBeInTheDocument();
    expect(within(form).queryByRole("group", { name: "Your share" })).not.toBeInTheDocument();
    await fill(user, form, { amount: "4800", title: "Salary" });
    await save(user);
    expect(await screen.findByText("Income added")).toBeInTheDocument();
    await waitFor(() => {
      expect(serverEntries(server)[0]).toMatchObject({ kind: "income", total: 480000, share: 480000, categoryId: "salary" });
    });
    expect(serverEntries(server)[0]?.tripId).toBeUndefined();
  });

  it("adds a repeating investment: the entry is the first occurrence of a new rule", async () => {
    const server = ledgerServer();
    const user = userEvent.setup();
    renderApp("/");
    const form = await openAdd(user);
    await user.click(within(form).getByRole("radio", { name: "Investment" }));
    expect(within(form).getByText(/isn't spending/)).toBeInTheDocument();
    await fill(user, form, { amount: "200", title: "Index fund", date: "2026-01-31" });
    await user.click(within(form).getByRole("button", { name: /More details/ }));
    await user.selectOptions(within(form).getByLabelText("Repeat"), "monthly");
    await save(user);
    expect(await screen.findByText("Investment added")).toBeInTheDocument();
    await waitFor(() => {
      expect(server.state.ledger.recurring).toHaveLength(1);
    });
    const [rule] = server.state.ledger.recurring as { id: string; frequency: string; nextDate: string; anchorDay: number }[];
    expect(rule).toMatchObject({ frequency: "monthly", anchorDay: 31 });
    // Occurrences up to today are recorded by the shared recurrence, each once, from the rule's next date.
    const entries = serverEntries(server);
    expect(entries.find((item) => item.date === "2026-01-31")?.recurringId).toBe(rule?.id);
    expect(entries.filter((item) => item.date === "2026-02-28")).toHaveLength(1);
  });

  it("checks every field before saving and moves focus to the first problem", async () => {
    const server = ledgerServer();
    const user = userEvent.setup();
    renderApp("/");
    const form = await openAdd(user);
    await user.click(within(form).getByLabelText("Title"));
    await save(user);
    expect(within(form).getByLabelText("Amount (CAD)")).toHaveFocus();
    expect(within(form).getByLabelText("Amount (CAD)")).toHaveAccessibleDescription("Enter an amount with up to two decimal places.");
    expect(within(form).getByLabelText("Title")).toHaveAccessibleDescription("Add a name for this entry.");

    await fill(user, form, { amount: "12.345" });
    await save(user);
    expect(within(form).getByLabelText("Amount (CAD)")).toHaveAccessibleDescription("Enter an amount with up to two decimal places.");

    await fill(user, form, { amount: "40", title: "Taxi" });
    await user.click(within(form).getByRole("button", { name: /More details/ }));
    await user.click(within(form).getByRole("radio", { name: "Amount" }));
    await user.type(within(form).getByLabelText("Your amount"), "50");
    await save(user);
    expect(within(form).getByLabelText("Your amount")).toHaveFocus();
    expect(within(form).getByLabelText("Your amount")).toHaveAccessibleDescription("Your share cannot exceed the receipt total.");
    expect(server.state.puts).toBe(0);
    expect((await stored())?.local.transactions).toHaveLength(0);
  });

  it("saves with Ctrl+Enter, and a second press while saving adds nothing twice", async () => {
    const server = ledgerServer();
    const user = userEvent.setup();
    renderApp("/");
    const form = await openAdd(user);
    await fill(user, form, { amount: "5", title: "Coffee" });
    await user.keyboard("{Control>}{Enter}{Enter}{/Control}");
    expect(await screen.findByText("Expense added")).toBeInTheDocument();
    await waitFor(() => {
      expect(serverEntries(server)).toHaveLength(1);
    });
    expect((await stored())?.local.transactions).toHaveLength(1);
  });

  it("keeps the draft when the dialog closes and brings it back, until it is discarded", async () => {
    ledgerServer();
    const user = userEvent.setup();
    renderApp("/");
    let form = await openAdd(user);
    await fill(user, form, { amount: "19.99", title: "Book" });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    form = await openAdd(user);
    expect(within(form).getByText(/Your unsaved draft is back/)).toBeInTheDocument();
    expect(within(form).getByLabelText("Amount (CAD)")).toHaveValue("19.99");
    expect(within(form).getByLabelText("Title")).toHaveValue("Book");
    await user.click(within(dialog()).getByRole("button", { name: "Discard draft" }));

    form = await openAdd(user);
    expect(within(form).getByLabelText("Title")).toHaveValue("");
    expect(within(form).queryByText(/Your unsaved draft is back/)).not.toBeInTheDocument();
  });

  it("creates a category inline from All categories and keeps the draft", async () => {
    const server = ledgerServer();
    const user = userEvent.setup();
    renderApp("/");
    const form = await openAdd(user);
    await fill(user, form, { amount: "30", title: "Vet visit" });
    const all = within(form).getByRole("button", { name: "All categories" });
    await user.click(all);
    const picker = screen.getByRole("dialog", { name: "Choose a category" });
    expect(within(picker).getByLabelText("Find a category")).toHaveFocus();
    await user.type(within(picker).getByLabelText("Find a category"), "gro");
    expect(within(picker).getByRole("button", { name: /Groceries/ })).toBeInTheDocument();
    expect(within(picker).queryByRole("button", { name: /Food/ })).not.toBeInTheDocument();
    // The salary category is income, so it isn't offered for an expense.
    expect(within(picker).queryByRole("button", { name: /Salary/ })).not.toBeInTheDocument();
    await user.type(within(picker).getByLabelText("New category"), "Pets");
    await user.click(within(picker).getByRole("button", { name: "Add category" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Choose a category" })).not.toBeInTheDocument();
    });
    expect(all).toHaveFocus();
    expect(within(form).getByRole("radio", { name: "Pets" })).toBeChecked();
    expect(within(form).getByLabelText("Title")).toHaveValue("Vet visit");
    await save(user);
    await waitFor(() => {
      expect(serverEntries(server)).toHaveLength(1);
    });
    const pets = server.state.ledger.categories.find((category) => category.name === "Pets");
    expect(pets).toMatchObject({ kind: "expense" });
    expect(serverEntries(server)[0]?.categoryId).toBe(pets?.id);
  });

  it("refuses a duplicate category name inline and keeps both dialogs open", async () => {
    ledgerServer();
    const user = userEvent.setup();
    renderApp("/");
    const form = await openAdd(user);
    await fill(user, form, { amount: "3" });
    await user.click(within(form).getByRole("button", { name: "All categories" }));
    const picker = screen.getByRole("dialog", { name: "Choose a category" });
    await user.type(within(picker).getByLabelText("New category"), "groceries");
    await user.click(within(picker).getByRole("button", { name: "Add category" }));
    expect(await within(picker).findByRole("alert")).toHaveTextContent("You already have a category with this name.");
    expect(within(picker).getByLabelText("New category")).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("form", { name: "Add entry" })).toBeInTheDocument();
    expect(within(form).getByLabelText("Amount (CAD)")).toHaveValue("3");
  });

  it("creates a payment account inline and chooses it", async () => {
    const server = ledgerServer();
    const user = userEvent.setup();
    renderApp("/");
    const form = await openAdd(user);
    await fill(user, form, { amount: "12", title: "Lunch" });
    await user.click(within(form).getByRole("button", { name: "New account" }));
    const accountDialog = screen.getByRole("dialog", { name: "New account" });
    await user.type(within(accountDialog).getByLabelText("Name"), "Travel card");
    await user.click(within(accountDialog).getByRole("radio", { name: "Credit card" }));
    await user.click(within(accountDialog).getByRole("button", { name: "Add account" }));
    await waitFor(() => {
      expect(within(form).getByLabelText("Account")).toHaveDisplayValue("Travel card");
    });
    await save(user);
    await waitFor(() => {
      expect(serverEntries(server)).toHaveLength(1);
    });
    const card = server.state.ledger.accounts.find((account) => account.name === "Travel card");
    expect(card).toMatchObject({ type: "credit" });
    expect(serverEntries(server)[0]?.accountId).toBe(card?.id);
  });

  it("saves offline on this device and syncs once the connection is back", async () => {
    const server = ledgerServer();
    const user = userEvent.setup();
    renderApp("/transactions?month=2026-11");
    const form = await openAdd(user);
    server.state.down = true;
    setOnline(false);
    await fill(user, form, { amount: "7.50", title: "Bakery", date: "2026-11-06" });
    await save(user);
    expect(await screen.findByText("Saved on this device. It syncs when you're back online.")).toBeInTheDocument();
    const row = (await screen.findByText("Bakery")).closest("li");
    expect(row).toHaveTextContent("Waiting to sync");
    expect(serverEntries(server)).toHaveLength(0);

    server.state.down = false;
    setOnline(true);
    await waitFor(() => {
      expect(serverEntries(server).map((item) => item.title)).toEqual(["Bakery"]);
    });
  });
});

describe("editing and deleting", () => {
  const coffee = entry("c1", "Coffee beans", { total: 1800, share: 1800, date: "2026-11-03", note: "Morning" });

  async function openEntry(user: UserEvent, title: string) {
    await user.click(await screen.findByRole("button", { name: new RegExp(title) }));
    return screen.findByRole("dialog", { name: title });
  }

  it("opens an entry from Activity, edits it and returns focus to its row", async () => {
    const server = ledgerServer({ transactions: [coffee] }, { search: () => [{ key: "personal:c1", source: "personal", match: null, entry: coffee }] });
    const user = userEvent.setup();
    renderApp("/transactions?month=2026-11");
    const detail = await openEntry(user, "Coffee beans");
    expect(within(detail).getByText("Morning")).toBeInTheDocument();
    await user.click(within(detail).getByRole("button", { name: "Edit" }));
    const form = await screen.findByRole("form", { name: "Edit entry" });
    expect(within(form).getByLabelText("Amount (CAD)")).toHaveValue("18.00");
    await fill(user, form, { amount: "21", title: "Coffee beans, decaf" });
    await save(user);
    expect(await screen.findByText("Changes saved")).toBeInTheDocument();
    await waitFor(() => {
      expect(serverEntries(server)).toEqual([expect.objectContaining({ id: "c1", title: "Coffee beans, decaf", total: 2100, share: 2100, note: "Morning" })]);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a change from another device next to the kept draft, then keeps mine on request", async () => {
    const { otherDevice, state } = ledgerServer({ transactions: [coffee] }, { search: () => [{ key: "personal:c1", source: "personal", match: null, entry: coffee }] });
    const user = userEvent.setup();
    renderApp("/transactions?month=2026-11");
    const detail = await openEntry(user, "Coffee beans");
    await user.click(within(detail).getByRole("button", { name: "Edit" }));
    const form = await screen.findByRole("form", { name: "Edit entry" });
    await fill(user, form, { title: "Mine" });

    // Another device renames it, and this tab syncs (focus) before Save is pressed.
    otherDevice((ledger) => ({ ...ledger, transactions: ledger.transactions.map((item) => (item.id === "c1" ? { ...item, title: "Theirs", total: 2500, share: 2500 } : item)) }));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Theirs" })).toBeInTheDocument();
    });
    await save(user);
    const banner = await within(form).findByRole("alert");
    expect(banner).toHaveTextContent("This entry changed on another device");
    expect(banner).toHaveTextContent("Theirs, $25.00");
    expect(within(form).getByLabelText("Title")).toHaveValue("Mine");

    await user.click(within(banner).getByRole("button", { name: "Keep my changes" }));
    await save(user);
    await waitFor(() => {
      expect(state.ledger.transactions).toEqual([expect.objectContaining({ id: "c1", title: "Mine", total: 1800 })]);
    });
  });

  it("asks before deleting, deletes through the offline store and can undo", async () => {
    const rent = entry("r1", "Rent", { total: 145000, share: 145000, date: "2026-11-01" });
    const server = ledgerServer({ transactions: [coffee, rent] }, { search: () => [personalHit(coffee), personalHit(rent)] });
    const user = userEvent.setup();
    renderApp("/transactions?month=2026-11");
    const detail = await openEntry(user, "Coffee beans");
    setOnline(false);
    await user.click(within(detail).getByRole("button", { name: "Delete" }));
    const confirm = screen.getByRole("dialog", { name: "Delete Coffee beans?" });
    expect(within(confirm).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Coffee beans deleted")).toBeInTheDocument();
    expect(screen.getByText("Deleted on this device. It syncs when you're back online.")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Coffee beans/ })).not.toBeInTheDocument();
    });
    // The row is gone, so focus returns to the search field.
    expect(screen.getByRole("searchbox", { name: "Search transactions" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("button", { name: /Coffee beans/ })).toBeInTheDocument();
    setOnline(true);
    await waitFor(() => {
      expect(server.state.ledger.transactions.map((item: WireEntry) => item.id).sort()).toEqual(["c1", "r1"]);
    });
  });
});

describe("where saving isn't possible", () => {
  it("explains that the demo doesn't save entries", async () => {
    stubServer((url) => (url === "/api/auth/me" ? json({ error: "Please sign in to continue." }, 401) : undefined));
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Explore a demo" }));
    await screen.findByText("You're exploring a demo");
    await user.keyboard("n");
    expect(screen.getByRole("dialog", { name: "Add entry" })).toHaveAccessibleDescription(/The demo doesn't save entries/);
  });
});
