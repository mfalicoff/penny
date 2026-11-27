import { emptyLedger, type Ledger, type Transaction } from "@domain/ledger.ts";
import { monthReview } from "@domain/monthReview.ts";
import { describe, expect, it } from "vitest";
import type { SharedRow } from "../src/api/projection";
import { ledgerWithShared } from "../src/features/home/model";
import {
  bannerMonth,
  changeChip,
  changeWords,
  compareBars,
  flowParts,
  householdOf,
  latestRecapMonth,
  longestRunLine,
  paidBy,
  quietDaysTitle,
  recapMonth,
  recapSearchSchema,
  shortMonthYear,
  spentSentence,
} from "../src/features/recap/model";

/**
 * The monthly recap's wording (MAZ-292) over the shared rule `monthReview`. Synthetic data only,
 * integer cents. The rule's own numbers are covered by tests/domain and the golden fixture.
 */

const entry = (id: string, extra: Partial<Transaction> = {}): Transaction => ({
  id,
  title: id,
  kind: "expense",
  total: 1000,
  share: 1000,
  categoryId: "groceries",
  date: "2026-10-05",
  note: "",
  ...extra,
});

const ledger = (transactions: Transaction[]): Ledger => ({ ...emptyLedger(), transactions });

const shared = (id: string, extra: Partial<SharedRow> = {}): SharedRow => ({
  id,
  householdId: "h1",
  householdName: "Apartment",
  householdCurrency: "CAD",
  title: `Shared ${id}`,
  date: "2026-10-10",
  totalCents: 18420,
  shareCents: 6140,
  payerUserId: "u2",
  payer: { email: "jo@example.test", displayName: "Jo" },
  paidByYou: false,
  category: { name: "Groceries", icon: "basket-outline", color: "#14B8A6" },
  note: "",
  ...extra,
});

const TODAY = "2026-11-03";
const review = (value: Ledger, rows: SharedRow[] = [], month = "2026-10") => {
  const view = ledgerWithShared(value, rows, []);
  return { view, review: monthReview(view, month, { today: TODAY }) };
};

describe("recap months", () => {
  it("opens a past month, last month by default, and ignores invalid or future months", () => {
    expect(latestRecapMonth(TODAY)).toBe("2026-10");
    expect(recapMonth(undefined, TODAY)).toBe("2026-10");
    expect(recapMonth("2025-03", TODAY)).toBe("2025-03");
    expect(recapMonth("2026-11", TODAY)).toBe("2026-10");
    expect(recapMonth("2027-01", "2027-01-15")).toBe("2026-12");
    expect(recapSearchSchema.parse({ month: "2026-13" })).toEqual({ month: undefined });
    expect(recapSearchSchema.parse({ month: "nope" })).toEqual({ month: undefined });
    expect(recapSearchSchema.parse({ month: "2026-09" })).toEqual({ month: "2026-09" });
  });

  it("offers the banner for last month during the first 7 days, until it's dismissed for that month", () => {
    expect(bannerMonth("2026-11-01", null)).toBe("2026-10");
    expect(bannerMonth("2026-11-07", "2026-09")).toBe("2026-10");
    expect(bannerMonth("2026-11-07", "2026-10")).toBeNull();
    expect(bannerMonth("2026-11-08", null)).toBeNull();
    expect(bannerMonth("2027-01-02", null)).toBe("2026-12");
  });
});

describe("recap wording", () => {
  const months = [
    entry("oct", { share: 229500, total: 229500 }),
    entry("sep", { date: "2026-09-12", share: 221000, total: 221000 }),
    entry("last-oct", { date: "2025-10-12", share: 214000, total: 214000 }),
  ];

  it("compares spending with the month before and the same month last year", () => {
    const { review: recap } = review(ledger(months));
    expect(spentSentence(recap)).toEqual({ lead: "4% more than September", rest: ", and 7% more than October last year." });
    const bars = compareBars(recap);
    expect(bars.map((bar) => [bar.label, bar.spent])).toEqual([
      ["October", 229500],
      ["September", 221000],
      ["Oct 2025", 214000],
    ]);
    expect(bars[0]?.width).toBe(100);
    expect(bars[1]?.width).toBeCloseTo(96.3, 1);
  });

  it("says there's nothing to compare with in place of a first month's bar", () => {
    const { review: recap } = review(ledger([entry("oct", { share: 5000, total: 5000 })]));
    const bars = compareBars(recap);
    expect(bars[1]).toMatchObject({ spent: null, width: 0, missing: "No September to compare with" });
    expect(bars[2]).toMatchObject({ spent: null, missing: "No Oct 2025 to compare with" });
    expect(spentSentence(recap)).toBeNull();
  });

  it("words less, the same, and a month with nothing spent", () => {
    const less = review(ledger([entry("oct", { share: 900, total: 900 }), entry("sep", { date: "2026-09-02" })])).review;
    expect(spentSentence(less)).toEqual({ lead: "10% less than September", rest: "." });
    const same = review(ledger([entry("oct"), entry("sep", { date: "2026-09-02" })])).review;
    expect(spentSentence(same)?.lead).toBe("The same as September");
    const income = review(ledger([entry("oct"), entry("pay", { kind: "income", categoryId: "salary", date: "2026-09-02" })])).review;
    expect(spentSentence(income)?.lead).toBe("Nothing spent in September");
  });

  it("shows New instead of an infinite percentage, with the typographic minus", () => {
    expect(changeChip(null)).toBe("New");
    expect(changeChip(18)).toBe("+18%");
    expect(changeChip(-12)).toBe("−12%");
    expect(changeChip(0)).toBe("0%");
    expect(changeWords(null)).toBe("New");
    expect(changeWords(-12)).toBe("Down 12%");
  });

  it("splits the flow bar by what came in, or by what went out when that's more", () => {
    const recap = review(
      ledger([
        entry("pay", { kind: "income", categoryId: "salary", share: 320000, total: 320000 }),
        entry("spent", { share: 229500, total: 229500 }),
        entry("fund", { kind: "investment", categoryId: "investments", share: 20000, total: 20000 }),
      ]),
    ).review;
    const parts = flowParts(recap);
    expect(parts.spent).toBeCloseTo(71.7, 1);
    expect(parts.invested).toBeCloseTo(6.25, 2);
    expect(parts.leftOver).toBeCloseTo(22, 0);
    const over = flowParts(review(ledger([entry("pay", { kind: "income", categoryId: "salary", share: 1000, total: 1000 }), entry("spent", { share: 3000, total: 3000 })])).review);
    expect(over).toEqual({ spent: 100, invested: 0, leftOver: 0 });
  });

  it("names the quiet days and the longest run", () => {
    expect(quietDaysTitle(9)).toBe("9 days without spending");
    expect(quietDaysTitle(1)).toBe("1 day without spending");
    expect(quietDaysTitle(0)).toBe("No day without spending");
    expect(longestRunLine({ start: "2026-10-19", end: "2026-10-22", days: 4 })).toBe("The longest run was Oct 19–22");
    expect(longestRunLine({ start: "2026-10-19", end: "2026-10-19", days: 1 })).toBeNull();
    expect(longestRunLine(null)).toBeNull();
    expect(shortMonthYear("2025-10")).toBe("Oct 2025");
  });
});

describe("the top shared expense", () => {
  it("says who paid it and its household, from the shared rows the view carries", () => {
    const { view, review: recap } = review(ledger([entry("oct")]), [shared("costco"), shared("small", { shareCents: 100, totalCents: 200 })]);
    const top = recap.shared.top;
    expect(top).toMatchObject({ title: "Shared costco", share: 6140, total: 18420, paidByYou: false });
    if (!top) throw new Error("no top shared expense");
    expect(paidBy(top)).toBe("Jo paid");
    expect(householdOf(view, top)).toBe("Apartment");
  });

  it("says You paid, and Former member for a deleted account, never its email", () => {
    expect(paidBy({ paidByYou: true, payer: { email: "me@example.test" } })).toBe("You paid");
    expect(paidBy({ paidByYou: false, payer: { email: "gone@example.test", deleted: true } })).toBe("Former member paid");
    expect(paidBy({ paidByYou: false, payer: { email: "sam@example.test" } })).toBe("sam@example.test paid");
    expect(paidBy({ paidByYou: null, payer: null })).toBeNull();
  });

  it("counts what others paid of your split expenses", () => {
    const { review: recap } = review(ledger([entry("dinner", { total: 4000, share: 2000 })]), [shared("costco")]);
    expect(recap.split).toMatchObject({ total: 22420, share: 8140, othersPaid: 14280 });
  });
});
