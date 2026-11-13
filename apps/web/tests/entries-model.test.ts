import { describe, expect, it } from "vitest";
import type { Ledger, Transaction } from "@domain/ledger.ts";
import { localRows, periodTotals, rowFilters } from "../src/features/activity/data";
import { ledgerWithShared, monthReport } from "../src/features/home/model";
import { danaOctober, totalsOf } from "./fakes/futureIncome";
import { activeDay, activitySearchSchema, periodOf, searchRange, shiftPeriod, without, withPeriod } from "../src/features/activity/filters";
import { buildEntry, categoryIcon, draftFromEntry, entryChange, frequentCategories, futureIncomeNote, inlineCategories, newDraft, withKind, type EntryDraft } from "../src/features/entries/model";

/** Synthetic data only. */
const ledger = (extra: Partial<Ledger> = {}): Ledger => ({
  version: 4,
  currency: "CAD",
  accounts: [{ id: "chq", name: "Chequing", type: "bank" }],
  trips: [{ id: "lis", name: "Lisbon", startDate: "2026-10-01", endDate: "2026-10-12" }],
  categories: [
    { id: "groceries", name: "Groceries", icon: "basket-outline", color: "#6C9C79", kind: "expense" },
    { id: "food", name: "Food & drinks", icon: "cafe-outline", color: "#E47850", kind: "expense" },
    { id: "salary", name: "Salary", icon: "briefcase-outline", color: "#6C9C79", kind: "income" },
    { id: "investments", name: "Investments", icon: "trending-up-outline", color: "#678DB1", kind: "investment" },
  ],
  transactions: [],
  recurring: [],
  ...extra,
});

const entry = (id: string, extra: Partial<Transaction> = {}): Transaction => ({ id, title: id, kind: "expense", total: 1000, share: 1000, categoryId: "groceries", date: "2026-11-02", note: "", ...extra });

const draft = (extra: Partial<EntryDraft> = {}): EntryDraft => ({ ...newDraft(ledger(), "expense", "2026-11-04"), amount: "84.20", title: "Dinner", categoryId: "food", ...extra });

describe("entry drafts", () => {
  it("builds each personal share mode in integer cents", () => {
    const share = (split: EntryDraft["split"], shareInput: string) => buildEntry(draft({ split, shareInput }), ledger()).built?.transaction.share;
    expect(share("full", "")).toBe(8420);
    expect(share("equal", "3")).toBe(2807);
    expect(share("amount", "20,50")).toBe(2050);
    expect(share("percent", "33.33")).toBe(2806);
  });

  it("reports problems against their fields", () => {
    expect(buildEntry(draft({ amount: "0", title: " " }), ledger()).errors).toEqual({ amount: "Enter an amount greater than zero.", title: "Add a name for this entry." });
    expect(buildEntry(draft({ amount: "1.234" }), ledger()).errors.amount).toBe("Enter an amount with up to two decimal places.");
    expect(buildEntry(draft({ date: "2026-02-30" }), ledger()).errors.date).toBe("Choose a date between 2000 and 2100.");
    expect(buildEntry(draft({ categoryId: "salary" }), ledger()).errors.category).toBe("Choose a category.");
    expect(buildEntry(draft({ accountId: "gone" }), ledger()).errors.account).toMatch(/isn't available/);
    expect(buildEntry(draft({ split: "equal", shareInput: "1" }), ledger()).errors.share).toBe("Split between 2 and 100 people.");
    expect(buildEntry(draft({ split: "percent", shareInput: "101" }), ledger()).errors.share).toBe("Your percentage must be between 0 and 100.");
  });

  it("keeps trips and splits on expenses only, and income at its full amount", () => {
    const income = buildEntry(draft({ kind: "income", categoryId: "salary", tripId: "lis", split: "percent", shareInput: "50" }), ledger()).built?.transaction;
    expect(income).toMatchObject({ kind: "income", total: 8420, share: 8420 });
    expect(income?.tripId).toBeUndefined();
    expect(buildEntry(draft({ tripId: "lis" }), ledger()).built?.transaction.tripId).toBe("lis");
  });

  it("creates a rule for a new repeating entry, with the entry as its first occurrence", () => {
    const built = buildEntry(draft({ date: "2026-01-31", repeat: "monthly" }), ledger()).built;
    expect(built?.rule).toMatchObject({ frequency: "monthly", nextDate: "2026-02-28", anchorDay: 31, active: true, total: 8420 });
    expect(built?.transaction.recurringId).toBe(built?.rule?.id);
    // Editing never creates a rule.
    const original = entry("e1");
    expect(buildEntry({ ...draftFromEntry(original), repeat: "weekly" }, ledger({ transactions: [original] }), original).built?.rule).toBeUndefined();
  });

  it("saves the same draft twice as one entry and one rule", () => {
    const built = buildEntry(draft({ repeat: "weekly" }), ledger()).built;
    if (!built) throw new Error("expected a valid draft");
    const once = entryChange(built)(ledger());
    const twice = entryChange(built)(once);
    expect(twice.transactions).toHaveLength(1);
    expect(twice.recurring).toHaveLength(1);
  });

  it("refuses a repeating entry at the schedule limit, which the server would refuse at sync", () => {
    const built = buildEntry(draft({ repeat: "weekly" }), ledger()).built;
    const rule = built?.rule;
    if (!built || !rule) throw new Error("expected a repeating draft");
    const full = ledger({ recurring: Array.from({ length: 1000 }, (_, index) => ({ ...rule, id: `r${String(index)}` })) });
    expect(() => entryChange(built)(full)).toThrow("up to 1000 schedules");
  });

  it("refuses a stale edit with the shared rule's message, and keeps the receipt and schedule link", () => {
    const original = entry("e1", { receipt: { id: "r1", name: "receipt.pdf", mime: "application/pdf", uri: "/api/receipts/r1" }, recurringId: "rule-1" });
    const edited = buildEntry({ ...draftFromEntry(original), title: "Edited" }, ledger({ transactions: [original] }), original).built;
    if (!edited) throw new Error("expected a valid draft");
    expect(edited.transaction).toMatchObject({ receipt: original.receipt, recurringId: "rule-1" });
    const changedElsewhere = ledger({ transactions: [{ ...original, title: "Theirs" }] });
    expect(() => entryChange(edited, original)(changedElsewhere)).toThrow("This entry changed on another device");
  });

  it("starts from the most used category of the kind and keeps a chosen one visible", () => {
    const used = ledger({ transactions: [entry("a", { categoryId: "food" }), entry("b", { categoryId: "food" }), entry("c")] });
    expect(frequentCategories(used, "expense").map((category) => category.id)).toEqual(["food", "groceries"]);
    expect(newDraft(used).categoryId).toBe("food");
    const many = Array.from({ length: 8 }, (_, index) => ({ id: `c${String(index)}`, name: `C${String(index)}`, icon: "", color: "#000000", kind: "expense" as const }));
    expect(inlineCategories(many, "c7", 3).map((category) => category.id)).toEqual(["c0", "c1", "c2", "c7"]);
    expect(withKind(draft(), "income", used).categoryId).toBe("salary");
    expect(categoryIcon("basket-outline")).toBe("basket");
    expect(categoryIcon("not-an-icon")).toBe("pricetag");
  });
});

describe("Activity filters", () => {
  it("falls back on bad values and reads the period", () => {
    expect(activitySearchSchema.parse({ month: "2026-13", year: "1999", day: "2026-02-31x", kind: "gift", q: "  rent " })).toEqual({ q: "rent" });
    expect(periodOf({ month: "2026-11", year: "2025" })).toEqual({ type: "month", month: "2026-11" });
    expect(periodOf({ day: "2026-11-04" })).toEqual({ type: "month", month: "2026-11" });
    expect(periodOf({})).toEqual({ type: "all" });
    expect(activeDay({ month: "2026-10", day: "2026-11-04" })).toBeUndefined();
    expect(searchRange({ year: "2026", day: "2026-03-04" })).toEqual({ from: "2026-03-04", to: "2026-03-04" });
    expect(searchRange({ year: "2026" })).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("steps through periods within 2000–2100 and drops the day", () => {
    expect(shiftPeriod({ month: "2026-12", day: "2026-12-03", kind: "income" }, 1)).toEqual({ month: "2027-01", kind: "income" });
    expect(shiftPeriod({ month: "2000-01" }, -1)).toEqual({ month: "2000-01" });
    expect(shiftPeriod({ year: "2100" }, 1)).toEqual({ year: "2100" });
    expect(withPeriod({ month: "2025-03", q: "x" }, "year")).toEqual({ year: "2025", q: "x" });
    expect(withPeriod({ year: "2024" }, "month", new Date(2026, 10, 10))).toEqual({ month: "2024-11" });
    expect(withPeriod({ month: "2024-02" }, "all")).toEqual({});
    expect(without({ q: "a", kind: "expense", month: "2026-11" }, "q", "kind")).toEqual({ month: "2026-11" });
  });
});

const shared = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  householdId: "h1",
  householdName: "Maison",
  householdCurrency: "CAD" as const,
  title: id,
  date: "2026-11-03",
  totalCents: 9000,
  shareCents: 3000,
  payerUserId: "u2",
  category: { name: "Groceries", icon: "basket-outline", color: "#6C9C79" },
  note: "",
  ...extra,
});

describe("Activity rows and totals", () => {
  const data = ledger({
    transactions: [
      entry("rent", { title: "Rent", total: 145000, share: 145000, date: "2026-11-01", categoryId: "food" }),
      entry("pay", { title: "Pay", kind: "income", categoryId: "salary", total: 480000, share: 480000, date: "2026-11-05" }),
      entry("fund", { title: "Fund", kind: "investment", categoryId: "investments", total: 20000, share: 20000, date: "2026-11-07" }),
      entry("oct", { title: "October groceries", date: "2026-10-30", note: "beans" }),
    ],
  });
  const rows = [shared("Hydro"), shared("Euro dinner", { householdCurrency: "EUR", shareCents: 999 }), shared("Market", { date: "2026-11-05", category: { name: "Food & drinks", icon: "cafe-outline", color: "#E47850" } })];

  it("totals the period from personal entries and shared shares, whatever the other filters", () => {
    const totals = periodTotals(data, { type: "month", month: "2026-11" }, rows, "2026-11-30");
    // 1450.00 personal + 30.00 + 30.00 shared; the EUR row is never added to a CAD ledger.
    expect(totals).toEqual({ expense: 151000, income: 480000, investment: 20000, net: 309000, shared: 6000, sharedCount: 2, expectedIncome: 0 });
  });

  it("never counts a shared row whose currency is not known", () => {
    const noCurrency = { ...shared("Hydro"), householdCurrency: undefined };
    expect(periodTotals(data, { type: "month", month: "2026-11" }, [noCurrency], "2026-11-30").sharedCount).toBe(0);
  });

  it("lists personal and shared rows newest first and applies type, day, category and text locally", () => {
    const all = localRows(data, rows, rowFilters({ month: "2026-11" }), new Set(["pay"]));
    expect(all.map((row) => row.key)).toEqual(["personal:fund", "personal:pay", "shared:Market", "shared:Euro dinner", "shared:Hydro", "personal:rent"]);
    expect(all.find((row) => row.key === "personal:pay")).toMatchObject({ pending: true });
    expect(localRows(data, rows, rowFilters({ month: "2026-11", kind: "income" }), new Set()).map((row) => row.key)).toEqual(["personal:pay"]);
    expect(localRows(data, rows, rowFilters({ month: "2026-11", day: "2026-11-05" }), new Set()).map((row) => row.key)).toEqual(["personal:pay", "shared:Market"]);
    // A personal category matches shared rows by name.
    expect(localRows(data, rows, rowFilters({ month: "2026-11", category: "food" }), new Set()).map((row) => row.key)).toEqual(["shared:Market", "personal:rent"]);
    expect(localRows(data, rows, rowFilters({ q: "maison" }), new Set()).map((row) => row.key)).toEqual(["shared:Market", "shared:Euro dinner", "shared:Hydro"]);
    expect(localRows(data, rows, rowFilters({ q: "BEANS" }), new Set()).map((row) => row.key)).toEqual(["personal:oct"]);
  });
});

describe("future-dated income (MAZ-136)", () => {
  it("notes that income dated after today is expected and counts toward Projected", () => {
    const note = futureIncomeNote({ kind: "income", date: "2026-11-15" }, "2026-11-11");
    expect(note).toMatch(/^Nov\.? 15 is still ahead, so this pay shows as expected\. /);
    expect(note).toContain("It counts toward Projected until the day it's recorded — not toward Left to spend.");
  });

  it("says nothing on or before today, for other kinds, or for an unfinished date", () => {
    expect(futureIncomeNote({ kind: "income", date: "2026-11-11" }, "2026-11-11")).toBeNull();
    expect(futureIncomeNote({ kind: "income", date: "2026-11-10" }, "2026-11-11")).toBeNull();
    expect(futureIncomeNote({ kind: "expense", date: "2026-11-15" }, "2026-11-11")).toBeNull();
    expect(futureIncomeNote({ kind: "investment", date: "2026-11-15" }, "2026-11-11")).toBeNull();
    expect(futureIncomeNote({ kind: "income", date: "" }, "2026-11-11")).toBeNull();
  });

  it("leaves income dated after today out of Activity's totals, so a month matches Home's recorded totals", () => {
    const { expected, seed, today, month } = danaOctober();
    const period = { type: "month", month } as const;
    const totals = periodTotals(seed, period, [], today);
    const home = monthReport(ledgerWithShared(seed, [], []), month, today);
    expect({ income: totals.income, expense: totals.expense, investment: totals.investment }).toEqual(home.recorded);
    expect({ income: totals.income, expense: totals.expense, investment: totals.investment }).toEqual(totalsOf(expected.recorded));
    expect(totals.net).toBe(home.recordedNet);
    // The freelance invoice (Oct 16) and the tax refund (Oct 28) are expected, still listed.
    expect(totals.expectedIncome).toBe(expected.expected.reduce((sum, line) => sum + line.shareCents, 0));
    const listed = localRows(seed, [], rowFilters({ month }), new Set()).map((row) => row.entry.title);
    expect(listed).toEqual(expect.arrayContaining(["Freelance invoice", "Tax refund", "Concert tickets"]));
    // A year or all time leaves them out the same way.
    expect(periodTotals(seed, { type: "year", year: month.slice(0, 4) }, [], today).income).toBe(300000 + expected.recorded.incomeCents);
  });

  it("counts income dated today and leaves out income dated tomorrow, until tomorrow", () => {
    const pay = (date: string) => entry(`pay-${date}`, { kind: "income", categoryId: "salary", total: 50000, share: 50000, date });
    const data = ledger({ transactions: [pay("2026-11-10"), pay("2026-11-11"), entry("tickets", { total: 9000, share: 9000, date: "2026-11-20" })] });
    const period = { type: "month", month: "2026-11" } as const;
    expect(periodTotals(data, period, [], "2026-11-10")).toMatchObject({ income: 50000, expense: 9000, net: 41000, expectedIncome: 50000 });
    expect(periodTotals(data, period, [], "2026-11-11")).toMatchObject({ income: 100000, expense: 9000, net: 91000, expectedIncome: 0 });
  });
});
