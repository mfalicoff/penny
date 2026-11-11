import { emptyLedger, type Ledger, type Recurring, type Transaction } from "@domain/ledger.ts";
import { describe, expect, it } from "vitest";
import type { SharedRow } from "../src/api/projection";
import { calendarDays, categoryComparison, flowNodeSummary, groupSmall, homeSearchSchema, ledgerWithShared, monthEntries, monthReport, shortLabel } from "../src/features/home/model";

/**
 * Home and Insights reporting (MAZ-92) against fixtures: the shared domain's month breakdown over
 * the ledger joined with shared shares. Synthetic data only, integer cents.
 */
const MONTH = "2026-11";

const entry = (id: string, extra: Partial<Transaction> = {}): Transaction => ({
  id,
  title: id,
  kind: "expense",
  total: 1000,
  share: 1000,
  categoryId: "groceries",
  date: "2026-11-05",
  note: "",
  ...extra,
});

const rule = (id: string, extra: Partial<Recurring> = {}): Recurring => ({
  id,
  title: id,
  kind: "income",
  total: 50000,
  share: 50000,
  categoryId: "salary",
  date: "2026-11-25",
  note: "",
  frequency: "monthly",
  nextDate: "2026-11-25",
  anchorDay: 25,
  active: true,
  ...extra,
});

const ledger = (transactions: Transaction[] = [], recurring: Recurring[] = []): Ledger => ({ ...emptyLedger(), transactions, recurring });

const shared = (id: string, extra: Partial<SharedRow> = {}): SharedRow => ({
  id,
  householdId: "h1",
  householdName: "Maison",
  householdCurrency: "CAD",
  title: `Shared ${id}`,
  date: "2026-11-10",
  totalCents: 6000,
  shareCents: 3000,
  payerUserId: "u2",
  category: { name: "Utilities", icon: "home-outline", color: "#3B82F6" },
  note: "",
  ...extra,
});

const report = (value: Ledger, rows: SharedRow[] = [], scheduled: SharedRow[] = []) => monthReport(ledgerWithShared(value, rows, scheduled), MONTH);

describe("month totals", () => {
  it("an empty month has zero totals, an empty flow and nothing to chart", () => {
    const result = report(ledger());
    expect(result.recorded).toEqual({ income: 0, expense: 0, investment: 0 });
    expect(result.recordedNet).toBe(0);
    expect(result.projectedNet).toBe(0);
    expect(result.flow.total).toBe(0);
    expect(result.spending).toEqual([]);
    expect(result.empty).toBe(true);
  });

  it("an income-only month leaves everything over", () => {
    const result = report(ledger([entry("pay", { kind: "income", categoryId: "salary", total: 320000, share: 320000 })]));
    expect(result.recorded.income).toBe(320000);
    expect(result.recordedNet).toBe(320000);
    expect(result.flow.remaining).toBe(320000);
    expect(result.flow.gap).toBe(0);
    expect(result.flow.destinations.map((node) => node.label)).toEqual(["Left over"]);
  });

  it("an expense-only month is overspent by every cent, shown as Beyond income", () => {
    const result = report(ledger([entry("rent", { total: 145000, share: 145000, categoryId: "home" })]));
    expect(result.recordedNet).toBe(-145000);
    expect(result.flow.gap).toBe(145000);
    expect(result.flow.sources.map((node) => node.label)).toEqual(["Beyond income"]);
    expect(result.spending.map((category) => [category.name, category.amount])).toEqual([["Home", 145000]]);
  });

  it("an overspent month counts investments as going out but not as spending", () => {
    const result = report(
      ledger([
        entry("pay", { kind: "income", categoryId: "salary", total: 100000, share: 100000 }),
        entry("rent", { total: 90000, share: 90000, categoryId: "home" }),
        entry("fund", { kind: "investment", categoryId: "investments", total: 20000, share: 20000 }),
      ]),
    );
    expect(result.recorded).toEqual({ income: 100000, expense: 90000, investment: 20000 });
    expect(result.recordedNet).toBe(-10000);
    expect(result.flow.gap).toBe(10000);
    expect(result.flow.destinations.find((node) => node.id === "investment:total")?.amount).toBe(20000);
    expect(result.spending.map((category) => category.name)).toEqual(["Home"]);
  });

  it("a break-even month has nothing left and no gap", () => {
    const result = report(ledger([entry("pay", { kind: "income", categoryId: "salary", total: 5000, share: 5000 }), entry("food", { total: 9000, share: 5000, categoryId: "food" })]));
    expect(result.recordedNet).toBe(0);
    expect(result.flow.gap).toBe(0);
    expect(result.flow.remaining).toBe(0);
    expect(result.flow.total).toBe(5000);
  });

  it("uses your share of a split expense, never the receipt total", () => {
    const result = report(ledger([entry("dinner", { total: 14880, share: 7440, categoryId: "food" })]));
    expect(result.recorded.expense).toBe(7440);
  });

  it("separates recorded from projected remaining and names expected recurring income", () => {
    const result = report(ledger([entry("rent", { total: 100000, share: 100000, categoryId: "home" })], [rule("pay"), rule("phone", { kind: "expense", total: 4500, share: 4500, categoryId: "other", nextDate: "2026-11-28", anchorDay: 28 })]));
    expect(result.recordedNet).toBe(-100000);
    expect(result.expectedIncome).toBe(50000);
    expect(result.projected).toEqual({ income: 50000, expense: 104500, investment: 0 });
    expect(result.projectedNet).toBe(-54500);
    expect(result.comingUp.map((item) => item.title)).toEqual(["pay", "phone"]);
    // The flow keeps its legacy input: recorded entries plus expected income.
    expect(result.flow.income).toBe(50000);
    expect(result.flow.expense).toBe(100000);
  });

  it("drops a personal preview once its occurrence is recorded", () => {
    const result = report(ledger([entry("pay:2026-11-25", { kind: "income", categoryId: "salary", total: 50000, share: 50000, date: "2026-11-25", recurringId: "pay" })], [rule("pay")]));
    expect(result.expectedIncome).toBe(0);
    expect(result.comingUp).toEqual([]);
    expect(result.projected.income).toBe(50000);
  });
});

describe("shared shares", () => {
  it("adds your recorded shares to spending and leaves other currencies out", () => {
    const result = report(ledger(), [shared("a"), shared("b", { householdCurrency: "EUR", shareCents: 9900 }), shared("c", { householdCurrency: undefined })]);
    expect(result.recorded.expense).toBe(3000);
    expect(result.sharedSpent).toBe(3000);
    expect(result.sharedCount).toBe(1);
    expect(result.spending.map((category) => [category.name, category.amount])).toEqual([["Utilities", 3000]]);
  });

  it("projects a shared preview, and drops it when the occurrence is recorded (household, rule and date, MAZ-139)", () => {
    const preview = shared("preview", { recurringId: "r1", date: "2026-11-20", scheduled: true, shareCents: 800 });
    const pending = report(ledger(), [], [preview]);
    expect(pending.recorded.expense).toBe(0);
    expect(pending.projected.expense).toBe(800);
    expect(pending.comingUp.map((item) => item.title)).toEqual(["Shared preview"]);

    const recorded = shared("recorded", { recurringId: "r1", date: "2026-11-20", shareCents: 800 });
    const done = report(ledger(), [recorded], [preview]);
    expect(done.recorded.expense).toBe(800);
    expect(done.projected.expense).toBe(800);
    expect(done.comingUp).toEqual([]);
  });

  it("keeps a preview from another household or date", () => {
    const preview = shared("preview", { recurringId: "r1", date: "2026-11-20", scheduled: true, shareCents: 800 });
    const other = shared("recorded", { householdId: "h2", recurringId: "r1", date: "2026-11-20", shareCents: 800 });
    expect(report(ledger(), [other], [preview]).projected.expense).toBe(1600);
  });

  it("never changes the ledger it was given", () => {
    const original = ledger([entry("a")]);
    const copy = structuredClone(original);
    ledgerWithShared(original, [shared("a")], [shared("b", { scheduled: true })]);
    expect(original).toEqual(copy);
  });
});

describe("filters never change totals", () => {
  it("filters the month's list by keyword, kind, day and category while the report stays the same", () => {
    const view = ledgerWithShared(ledger([entry("coffee", { title: "Morning coffee", categoryId: "food", date: "2026-11-03" }), entry("rent", { categoryId: "home", total: 90000, share: 90000 }), entry("pay", { kind: "income", categoryId: "salary" })], [rule("salary")]), [shared("h")], []);
    const before = monthReport(view, MONTH);
    expect(monthEntries(view, MONTH, { day: undefined, q: "coffee", kind: undefined, category: undefined }).map((item) => item.id)).toEqual(["coffee"]);
    expect(monthEntries(view, MONTH, { day: "2026-11-03", q: undefined, kind: undefined, category: undefined }).map((item) => item.id)).toEqual(["coffee"]);
    expect(monthEntries(view, MONTH, { day: undefined, q: undefined, kind: "income", category: undefined }).map((item) => item.id)).toEqual(["salary:2026-11-25", "pay"]);
    expect(monthEntries(view, MONTH, { day: undefined, q: "maison", kind: undefined, category: undefined })).toEqual([]);
    expect(monthEntries(view, MONTH, { day: undefined, q: "shared", kind: undefined, category: undefined }).map((item) => item.id)).toEqual(["household:h1:h"]);
    // A day outside the month is ignored.
    expect(monthEntries(view, MONTH, { day: "2026-10-03", q: undefined, kind: undefined, category: undefined })).toHaveLength(5);
    expect(monthReport(view, MONTH)).toEqual(before);
  });
});

describe("grouping and labels", () => {
  const category = (id: string, amount: number) => ({ id, name: id, icon: "basket-outline", color: "#0FA3A3", kind: "expense" as const, amount });

  it("keeps up to six categories and groups the rest of the small ones into N more, keeping every cent", () => {
    expect(groupSmall([category("a", 5), category("b", 4)]).rows).toHaveLength(2);
    expect(groupSmall(["a", "b", "c", "d", "e", "f"].map((id, index) => category(id, 10 - index))).rows).toHaveLength(6);
    const grouped = groupSmall(["a", "b", "c", "d", "e", "f", "g", "h"].map((id, index) => category(id, 100 - index)));
    expect(grouped.rows.map((row) => row.name)).toEqual(["a", "b", "c", "d", "e", "3 more"]);
    expect(grouped.rows.at(-1)?.amount).toBe(95 + 94 + 93);
    expect(grouped.rows.reduce((sum, row) => sum + row.amount, 0)).toBe(grouped.total);
  });

  it("the money flow groups small categories the same way, so the chart stays readable", () => {
    const entries = Array.from({ length: 9 }, (_, index) => entry(`e${String(index)}`, { categoryId: `c${String(index)}`, total: 1000 + index, share: 1000 + index }));
    const value = { ...ledger(entries), categories: entries.map((item) => ({ id: item.categoryId, name: item.categoryId, icon: "basket-outline", color: "#0FA3A3", kind: "expense" as const })) };
    const flow = report(value).flow;
    expect(flow.destinations.filter((node) => node.id.startsWith("expense:"))).toHaveLength(6);
    expect(flow.destinations.find((node) => node.id === "expense:overflow")?.amount).toBe(1000 + 1001 + 1002 + 1003);
    expect(flow.expense).toBe(entries.reduce((sum, item) => sum + item.share, 0));
  });

  it("shortens long labels on the chart only", () => {
    const long = "A very long category name that never ends";
    expect(shortLabel(long)).toBe("A very long categ…");
    expect(shortLabel("Groceries")).toBe("Groceries");
    // Graphemes, so an emoji family is never cut in half.
    expect(shortLabel("Café 👩‍👩‍👧 family dinner")).toBe("Café 👩‍👩‍👧 family din…");
    const result = report({ ...ledger([entry("x", { categoryId: "long" })]), categories: [{ id: "long", name: long, icon: "basket-outline", color: "#0FA3A3", kind: "expense" }] });
    expect(result.flow.destinations[0]?.label).toBe(long);
    const [node] = result.flow.destinations;
    if (!node) throw new Error("no destination");
    expect(flowNodeSummary(node, result.flow, "out")).toBe("0% of what came in, 100% of what went out");
  });

  it("compares categories by name with last month and groups the long tail", () => {
    const rows = categoryComparison([category("Food", 300), category("Home", 1000)], [category("food", 500), category("Travel", 200)]);
    expect(rows.map((row) => [row.name, row.current, row.previous, row.change, row.share])).toEqual([
      ["Home", 1000, 0, 1000, 77],
      ["Food", 300, 500, -200, 23],
      ["Travel", 0, 200, -200, 0],
    ]);
    const many = categoryComparison(Array.from({ length: 12 }, (_, index) => category(`c${String(index)}`, 100 - index)), []);
    expect(many).toHaveLength(9);
    expect(many.at(-1)?.name).toBe("4 more");
  });
});

describe("calendar", () => {
  it("builds the month's days in one pass, scheduled kept apart from recorded", () => {
    const view = ledgerWithShared(ledger([entry("a", { date: "2026-11-06" }), entry("b", { kind: "investment", categoryId: "investments", date: "2026-11-06", share: 200, total: 200 })], [rule("pay")]), [], []);
    const { offset, days } = calendarDays(MONTH, monthReport(view, MONTH).calendarEntries);
    expect(offset).toBe(6); // 2026-11-01 is a Sunday
    expect(days).toHaveLength(30);
    expect(days[5]).toMatchObject({ date: "2026-11-06", count: 2, expense: 1000, investment: 200, scheduled: 0 });
    expect(days[24]).toMatchObject({ date: "2026-11-25", count: 1, income: 0, scheduled: 1 });
  });
});

describe("URL", () => {
  it("falls back on bad values", () => {
    expect(homeSearchSchema.parse({ month: "2026-13", day: "nope", kind: "gift", q: "  coffee " })).toEqual({ month: undefined, day: undefined, kind: undefined, q: "coffee", category: undefined });
    expect(homeSearchSchema.parse({ month: "1999-12" }).month).toBeUndefined();
  });
});

describe("performance baseline", () => {
  it("reports a month of a 20,000-entry ledger with 40 shared rows in bounded time", () => {
    const entries = Array.from({ length: 20_000 }, (_, index) => {
      const month = String((index % 12) + 1).padStart(2, "0");
      const day = String((index % 28) + 1).padStart(2, "0");
      return entry(`e${String(index)}`, { date: `2026-${month}-${day}`, categoryId: ["groceries", "food", "home", "transport"][index % 4] ?? "other", kind: index % 10 === 0 ? "income" : "expense" });
    });
    const rows = Array.from({ length: 40 }, (_, index) => shared(`s${String(index)}`, { date: `2026-11-${String((index % 28) + 1).padStart(2, "0")}` }));
    const big = ledger(entries, [rule("pay")]);
    const started = performance.now();
    const view = ledgerWithShared(big, rows, []);
    const result = monthReport(view, MONTH);
    calendarDays(MONTH, result.calendarEntries);
    monthEntries(view, MONTH, { day: undefined, q: "e1", kind: undefined, category: undefined });
    const elapsed = performance.now() - started;
    expect(result.recordedEntries.length).toBeGreaterThan(1600);
    // Baseline: about 200 ms cold in Vitest and jsdom on a 2026 laptop (docs: README "Home and Insights").
    // The bound only catches an accidental quadratic (per-day or per-category scans of the ledger).
    expect(elapsed).toBeLessThan(2000);
  });
});
