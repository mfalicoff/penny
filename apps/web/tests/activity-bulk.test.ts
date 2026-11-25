import type { Ledger, Transaction } from "@domain/ledger.ts";
import { initialCategories } from "@domain/ledger.ts";
import { describe, expect, it } from "vitest";
import { BULK_ACTIONS, restoreEntries, SelectionChanged, type ConfirmAction, type PickAction, type Selection } from "../src/features/activity/bulkActions";

/** Activity's bulk actions (MAZ-276): one change per action, undone in one change. Synthetic data only. */

const entry = (id: string, title: string, extra: Partial<Transaction> = {}): Transaction => ({ id, title, kind: "expense", total: 1000, share: 1000, categoryId: "groceries", date: "2026-11-09", note: "", ...extra });

const ledger: Ledger = {
  version: 4,
  currency: "CAD",
  accounts: [
    { id: "chq", name: "Main chequing", type: "bank" },
    { id: "visa", name: "Visa", type: "credit" },
  ],
  trips: [],
  categories: [...initialCategories, { id: "salary", name: "Salary", icon: "briefcase-outline", color: "#6C9C79", kind: "income" }],
  transactions: [
    entry("g", "Groceries", { share: 4890, total: 4890, accountId: "chq" }),
    entry("c", "Coffee with Mira", { categoryId: "food", total: 1280, share: 640, accountId: "visa" }),
    entry("t", "Transit pass", { categoryId: "transport", share: 6200, total: 6200, date: "2026-11-06", accountId: "visa", recurringId: "r1" }),
    entry("p", "Payday", { kind: "income", categoryId: "salary", total: 320000, share: 320000 }),
  ],
  recurring: [{ ...entry("r1", "Transit pass", { categoryId: "transport", accountId: "visa" }), frequency: "monthly", nextDate: "2026-12-06", anchorDay: 6, active: true }],
};

const pick = (id: string) => BULK_ACTIONS.find((action) => action.id === id) as PickAction;
const confirm = BULK_ACTIONS.find((action) => action.kind === "confirm") as ConfirmAction;
const select = (...ids: string[]): Selection => ({ ledger, entries: ids.map((id) => ledger.transactions.find((item) => item.id === id) as Transaction) });
const byId = (next: Ledger, id: string) => next.transactions.find((item) => item.id === id);

describe("bulk actions", () => {
  it("lists Change category, Change account, then the destructive Delete", () => {
    expect(BULK_ACTIONS.map((action) => [action.label, action.kind, Boolean(action.danger)])).toEqual([
      ["Change category", "pick", false],
      ["Change account", "pick", false],
      ["Delete", "confirm", true],
    ]);
  });

  it("offers only the selection's type of category, counts the ones in use, and notes a schedule", () => {
    const category = pick("category");
    const selection = select("g", "c", "t");
    expect(category.title(selection)).toBe("Category for 3 expenses");
    const options = category.options(selection);
    expect(options.map((option) => option.label)).not.toContain("Salary");
    expect(options.find((option) => option.id === "food")).toMatchObject({ count: 1, icon: "cafe" });
    expect(category.note?.(selection)).toBe("Transit pass repeats monthly. Its schedule keeps its own category.");
    expect(category.unavailable?.(selection)).toBeNull();
    expect(category.unavailable?.(select("g", "p"))).toBe("Select entries of one type to change their category");
  });

  it("changes every entry's category in one change and leaves the schedule alone", () => {
    const outcome = pick("category").apply(select("g", "c", "t"), "food");
    expect(outcome.done).toBe("3 entries moved to Food & drinks");
    const next = outcome.change(ledger);
    expect(["g", "c", "t"].map((id) => byId(next, id)?.categoryId)).toEqual(["food", "food", "food"]);
    expect(next.recurring[0]?.categoryId).toBe("transport");
    expect(byId(next, "p")).toEqual(byId(ledger, "p"));
  });

  it("sets or removes the account", () => {
    const account = pick("account");
    const selection = select("g", "c");
    expect(account.options(selection).map((option) => [option.label, option.count])).toEqual([
      ["Main chequing", 1],
      ["Visa", 1],
      ["No account", 0],
    ]);
    const moved = account.apply(selection, "visa");
    expect(moved.done).toBe("2 entries moved to Visa");
    expect(byId(moved.change(ledger), "g")?.accountId).toBe("visa");
    const removed = account.apply(selection, "");
    expect(removed.done).toBe("Account removed from 2 entries");
    const next = removed.change(ledger);
    expect(byId(next, "g")).not.toHaveProperty("accountId");
    expect(byId(next, "c")).not.toHaveProperty("accountId");
  });

  it("deletes the selection after confirming, and Undo puts every entry back in one change", () => {
    const selection = select("g", "c", "t");
    expect(confirm.title(selection)).toBe("Delete 3 entries?");
    expect(confirm.confirmLabel(selection)).toBe("Delete 3 entries");
    expect(confirm.note?.(selection)).toBe("Transit pass repeats monthly. Only this month's entry is deleted; the schedule keeps going.");
    const outcome = confirm.apply(selection);
    expect(outcome.done).toBe("3 entries deleted");
    const next = outcome.change(ledger);
    expect(next.transactions.map((item) => item.id)).toEqual(["p"]);
    expect(next.recurring).toHaveLength(1);
    const restored = restoreEntries(selection.entries)(next);
    expect([...restored.transactions].sort((a, b) => a.id.localeCompare(b.id))).toEqual([...ledger.transactions].sort((a, b) => a.id.localeCompare(b.id)));
  });

  it("changes nothing when an entry changed on another device meanwhile", () => {
    const changed = { ...ledger, transactions: ledger.transactions.map((item) => (item.id === "c" ? { ...item, title: "Coffee" } : item)) };
    expect(() => pick("category").apply(select("g", "c"), "home").change(changed)).toThrow(SelectionChanged);
    expect(() => confirm.apply(select("g", "c")).change(changed)).toThrow(SelectionChanged);
  });

  it("says a single entry and several repeating ones plainly", () => {
    expect(pick("account").title(select("g"))).toBe("Account for 1 entry");
    expect(pick("category").title(select("p"))).toBe("Category for 1 income entry");
    const twice = { ...ledger, transactions: ledger.transactions.map((item) => (item.id === "g" ? { ...item, recurringId: "r1" } : item)) };
    const selection = { ledger: twice, entries: twice.transactions.filter((item) => item.id === "g" || item.id === "t") };
    expect(confirm.note?.(selection)).toBe("2 of these repeat. Only these entries are deleted; their schedules keep going.");
  });
});
