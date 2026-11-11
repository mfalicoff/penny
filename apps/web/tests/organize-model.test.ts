// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { saveAccount, saveCategory } from "@domain/commands.ts";
import { emptyLedger, type Category, type Ledger, type PaymentAccount, type Recurring, type Transaction } from "@domain/ledger.ts";
import { mergeLedger } from "@domain/merge.ts";
import {
  accountNameProblem,
  accountUsage,
  categoryIcon,
  categoryNameProblem,
  categoryUsage,
  CATEGORY_COLORS,
  HOUSEHOLD_LINK_MESSAGE,
  moveAccountAndRemove,
  moveCategoryAndRemove,
  refusedAccountRemovals,
  restoreAccount,
  restoreCategory,
  storedIcon,
  unsyncedIds,
  usageOf,
  usageSentence,
  usageText,
  type Moved,
} from "../src/features/organize/model";

// Synthetic records only.
const visa: PaymentAccount = { id: "visa", name: "Visa", type: "credit" };
const cash: PaymentAccount = { id: "cash", name: "Wallet", type: "cash" };
const entry = (id: string, extra: Partial<Transaction> = {}): Transaction => ({ id, title: id, kind: "expense", total: 500, share: 500, categoryId: "groceries", date: "2026-11-01", note: "", ...extra });
const rule = (id: string, extra: Partial<Recurring> = {}): Recurring => ({ ...entry(id), frequency: "monthly", nextDate: "2026-12-01", anchorDay: 1, active: true, ...extra });

function ledger(extra: Partial<Ledger> = {}): Ledger {
  return { ...emptyLedger(), accounts: [visa, cash], ...extra };
}

describe("usage", () => {
  it("counts entries and schedules per account and category, in words", () => {
    const value = ledger({
      transactions: [entry("a", { accountId: "visa" }), entry("b", { accountId: "visa", categoryId: "food" }), entry("c")],
      recurring: [rule("r", { accountId: "visa" })],
    });
    expect(usageOf(accountUsage(value), "visa")).toEqual({ entries: 2, schedules: 1 });
    expect(usageOf(accountUsage(value), "cash")).toEqual({ entries: 0, schedules: 0 });
    expect(usageOf(categoryUsage(value), "groceries")).toEqual({ entries: 2, schedules: 1 });
    expect(usageText({ entries: 2, schedules: 1 })).toBe("2 entries, 1 schedule");
    expect(usageText({ entries: 1, schedules: 0 })).toBe("1 entry");
    expect(usageText({ entries: 0, schedules: 3 })).toBe("3 schedules");
    expect(usageText({ entries: 0, schedules: 0 })).toBe("not used yet");
    expect(usageSentence({ entries: 31, schedules: 3 })).toBe("31 entries and 3 schedules");
  });
});

describe("names", () => {
  it("matches the shared rules: trimmed, 1–50 characters, unique ignoring case (per kind for categories)", () => {
    const value = ledger();
    expect(accountNameProblem(value, "   ")).toBe("Give your account a name.");
    expect(accountNameProblem(value, "x".repeat(51))).toBe("Use up to 50 characters.");
    expect(accountNameProblem(value, " visa ")).toBe("You already have an account with this name.");
    expect(accountNameProblem(value, "VISA", "visa")).toBeNull();
    expect(categoryNameProblem(value, "groceries", "expense")).toBe("You already have an expense category with this name.");
    expect(categoryNameProblem(value, "Groceries", "income")).toBeNull();
    // The client check agrees with the shared command.
    expect(() => saveAccount({ id: "n", name: "visa", type: "bank" })(value)).toThrow("You already have an account with this name.");
    expect(() => saveCategory({ id: "n", name: "GROCERIES", icon: "pricetag-outline", color: "#3B82F6", kind: "expense" })(value)).toThrow("You already have a category with this name.");
  });
});

describe("icons and colors", () => {
  it("draws stored Ionicons names with the kit's glyphs and stores the names other clients write", () => {
    expect(categoryIcon("basket-outline")).toBe("basket");
    expect(categoryIcon("home")).toBe("home");
    expect(categoryIcon("paw")).toBe("pricetag");
    expect(storedIcon("airplane")).toBe("airplane-outline");
  });

  it("offers only the category palette, never a meaning color", () => {
    const tokens = readFileSync(new URL("../src/design/tokens.css", import.meta.url), "utf8");
    const meaning = [...tokens.matchAll(/--pk-(?:tint|income|invest|pending|danger): (#[0-9A-Fa-f]{6});/g)].map((match) => match[1]?.toUpperCase());
    expect(meaning.length).toBeGreaterThanOrEqual(5);
    for (const color of CATEGORY_COLORS) {
      expect(color.value).toMatch(/^#[0-9A-F]{6}$/);
      expect(meaning).not.toContain(color.value);
      // Every palette color is a token from the design kit.
      expect(tokens.toUpperCase()).toContain(color.value);
    }
  });
});

describe("moving links before a removal", () => {
  it("moves every entry and schedule, removes the account in the same change, and Undo puts the links back", () => {
    const before = ledger({
      transactions: [entry("a", { accountId: "visa" }), entry("b", { accountId: "cash" })],
      recurring: [rule("r", { accountId: "visa" })],
    });
    let moved: Moved | undefined;
    const after = moveAccountAndRemove(visa, cash, (value) => {
      moved = value;
    })(before);
    expect(after.accounts).toEqual([cash]);
    expect(after.transactions.map((item) => item.accountId)).toEqual(["cash", "cash"]);
    expect(after.recurring.map((item) => item.accountId)).toEqual(["cash"]);
    expect(moved).toEqual({ entryIds: ["a"], scheduleIds: ["r"] });

    const undone = restoreAccount(visa, moved, cash.id)(after);
    expect(undone.accounts).toEqual([cash, visa]);
    expect(undone.transactions).toEqual(before.transactions);
    expect(undone.recurring).toEqual(before.recurring);
    // Undo twice changes nothing.
    expect(restoreAccount(visa, moved, cash.id)(undone)).toBe(undone);
  });

  it("refuses a target removed elsewhere and a stale account, and the plain removal of one in use", () => {
    const value = ledger({ transactions: [entry("a", { accountId: "visa" })] });
    expect(() => moveAccountAndRemove(visa, { id: "gone", name: "Gone", type: "bank" })(value)).toThrow("Gone was removed on another device. Choose another account.");
    expect(() => moveAccountAndRemove({ ...visa, name: "Old name" }, cash)(value)).toThrow("This account changed on another device. Reopen it before editing.");
    expect(() => saveAccount(visa, visa, true)(value)).toThrow("This account has entries or schedules. Reassign them before deleting it.");
  });

  it("moves a category's entries only to one of the same kind", () => {
    const food: Category = { id: "food", name: "Food & drinks", icon: "cafe-outline", color: "#E47850", kind: "expense" };
    const groceries = emptyLedger().categories.find((item) => item.id === "groceries") as Category;
    const salary = emptyLedger().categories.find((item) => item.id === "salary") as Category;
    const value = ledger({ transactions: [entry("a"), entry("b", { categoryId: "food" })], recurring: [rule("r")] });
    expect(() => moveCategoryAndRemove(groceries, salary)(value)).toThrow("Salary was removed on another device. Choose another category.");
    let moved: Moved | undefined;
    const after = moveCategoryAndRemove(groceries, food, (record) => {
      moved = record;
    })(value);
    expect(after.categories.some((item) => item.id === "groceries")).toBe(false);
    expect(after.transactions.map((item) => item.categoryId)).toEqual(["food", "food"]);
    const undone = restoreCategory(groceries, moved, food.id)(after);
    expect(undone.transactions.map((item) => item.categoryId)).toEqual(["groceries", "food"]);
    expect(undone.recurring.map((item) => item.categoryId)).toEqual(["groceries"]);
  });
});

describe("sync state", () => {
  it("marks records that differ from the server's copy as waiting", () => {
    expect([...unsyncedIds([visa, { ...cash, name: "Jar" }], [visa, cash])]).toEqual(["cash"]);
    expect([...unsyncedIds([visa], null)]).toEqual([]);
  });

  it("a rename here and a type change elsewhere both survive the merge", () => {
    const base = ledger();
    const local = saveAccount({ ...visa, name: "Travel card" }, visa)(base);
    const remote = { ...base, accounts: [{ ...visa, type: "other" as const }, cash] };
    expect(mergeLedger(base, local, remote).accounts).toEqual([{ id: "visa", name: "Travel card", type: "other" }, cash]);
  });

  it("finds accounts the server kept because a shared expense links them", () => {
    const server = ledger();
    const local = saveAccount(visa, visa, true)(server);
    expect(refusedAccountRemovals(`The server refused this sync: ${HOUSEHOLD_LINK_MESSAGE} Your changes are kept in this browser.`, local, server)).toEqual([visa]);
    expect(refusedAccountRemovals("The server refused this sync: Invalid ledger data.", local, server)).toEqual([]);
    expect(refusedAccountRemovals(undefined, local, server)).toEqual([]);
    expect(refusedAccountRemovals(HOUSEHOLD_LINK_MESSAGE, local, null)).toEqual([]);
  });
});
