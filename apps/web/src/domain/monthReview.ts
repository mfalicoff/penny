import { calendarMonth, shiftMonthKey } from "./calendar.ts";
import type { Category, Ledger, Transaction } from "./ledger.ts";
import { monthBreakdown, net, type MonthOptions, type OverviewEntry } from "./summary.ts";
import type { ExpensePayer } from "./householdProjection.ts";

/**
 * The monthly recap (MAZ-292): last month's recorded numbers, next to the month before it and the
 * same month a year earlier. Named `MonthReview` because `MonthRecap` is the household settlement
 * schema (docs/reference/settlement.md). The reference for the Swift rule
 * (`PennyDomain/Ledger/MonthReview.swift`) and `contracts/fixtures/month-review.json`.
 *
 * Input is the person's ledger view with their shared shares joined in (`ledgerWithHouseholds`),
 * so shared expenses count at the person's share and shared rows in another currency are already
 * left out. Only recorded entries count, never scheduled previews (`monthBreakdown`).
 *
 * All amounts are integer cents. Percentages are whole numbers rounded half away from zero, the
 * same in Swift, and are `null` where there is nothing to compare with (never ±∞).
 */

/** Whole percent of `part` in `whole` (0 when there is no whole), rounded half away from zero. */
export const percentOf = (part: number, whole: number) => (whole > 0 ? roundPercent((part / whole) * 100) : 0);

// `+ 0` turns -0 into 0, so a tiny drop reads 0%, as in Swift.
const roundPercent = (value: number) => Math.sign(value) * Math.round(Math.abs(value)) + 0;

/** Whole-percent change from `before` to `after`; null when `before` isn't known or is 0. */
export const percentChange = (after: number, before: number | null): number | null =>
  before === null || before <= 0 ? null : roundPercent(((after - before) / before) * 100);

/* ---------- category comparison (moved from the web's Insights model) ---------- */

export type CategorySpending = Pick<Category, "id" | "name" | "icon" | "color"> & { amount: number };

export interface CategoryChange {
  key: string;
  name: string;
  icon: string;
  color: string;
  current: number;
  previous: number;
  /** current − previous */
  change: number;
  /** Whole percent of this month's spending. */
  share: number;
}

const categoryKey = (name: string) => name.trim().toLowerCase();

/**
 * This month's spending by category next to last month's. Categories match by name, trimmed and
 * without case (shared categories travel by value, and the same name is the same category to the
 * person); past `limit + 1` rows, the smallest are summed into one "N more" row (`key: "more"`).
 * `limit: null` keeps every row.
 */
export function categoryComparison(current: readonly CategorySpending[], previous: readonly CategorySpending[], limit: number | null = 8): CategoryChange[] {
  const rows = new Map<string, CategoryChange>();
  for (const [list, field] of [
    [current, "current"],
    [previous, "previous"],
  ] as const) {
    for (const category of list) {
      const key = categoryKey(category.name);
      const row = rows.get(key) ?? { key, name: category.name, icon: category.icon, color: category.color, current: 0, previous: 0, change: 0, share: 0 };
      row[field] += category.amount;
      rows.set(key, row);
    }
  }
  const total = current.reduce((sum, category) => sum + category.amount, 0);
  const sorted = [...rows.values()]
    .map((row) => ({ ...row, change: row.current - row.previous, share: percentOf(row.current, total) }))
    .sort((a, b) => b.current - a.current || b.previous - a.previous || compareKeys(a.key, b.key));
  if (limit === null || sorted.length <= limit + 1) return sorted;
  const rest = sorted.slice(limit);
  const sum = (field: "current" | "previous") => rest.reduce((value, row) => value + row[field], 0);
  const more = { key: "more", name: `${String(rest.length)} more`, icon: "ellipsis-horizontal", color: "", current: sum("current"), previous: sum("previous"), change: 0, share: 0 };
  return [...sorted.slice(0, limit), { ...more, change: more.current - more.previous, share: percentOf(more.current, total) }];
}

// Code-unit order, so Swift (UTF-16 comparison) sorts the same.
const compareKeys = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The month-over-month sentence (card `iphone-insights`): the change in recorded spending and the
 * (at most two) categories that moved most in that direction ("Mostly Food & drinks and
 * Shopping."). The grouped "N more" row is never named.
 */
export function spendingChange(current: number, previous: number, comparison: readonly CategoryChange[]): { delta: number; drivers: string[] } {
  const delta = current - previous;
  if (delta === 0) return { delta, drivers: [] };
  const drivers = comparison
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.key !== "more" && Math.sign(row.change) === Math.sign(delta))
    .sort((a, b) => Math.abs(b.row.change) - Math.abs(a.row.change) || a.index - b.index)
    .slice(0, 2)
    .map(({ row }) => row.name);
  return { delta, drivers };
}

/* ---------- the recap ---------- */

/** A shared share in the view, with who paid it (MAZ-275) when the projection says. */
type SharedView = Transaction & { householdId: string; householdExpenseId: string; paidByYou?: boolean; payer?: ExpensePayer };
const isShared = (entry: Transaction): entry is SharedView => "householdExpenseId" in entry;

export interface ComparedMonth {
  month: string;
  /** Recorded spending; null when nothing is recorded in or before this month ("No September to compare with"). */
  spent: number | null;
  /** Whole-percent change of the recap month's spending against this month; null with nothing to compare. */
  change: number | null;
}

export interface BiggestChange {
  key: string;
  name: string;
  icon: string;
  color: string;
  current: number;
  previous: number;
  change: number;
  /** Whole-percent change; null for a category with nothing the month before ("New"). */
  percent: number | null;
}

export interface TopShared {
  id: string;
  title: string;
  categoryId: string;
  date: string;
  share: number;
  total: number;
  paidByYou: boolean | null;
  payer: ExpensePayer | null;
}

export interface MonthReview {
  month: string;
  /** No recorded entry in the month (a month with only scheduled entries counts as none). */
  empty: boolean;
  spent: number;
  cameIn: number;
  invested: number;
  /** Came in − spent − invested; negative means overspent. */
  leftOver: number;
  previous: ComparedMonth;
  lastYear: ComparedMonth;
  /** Up to three categories that moved most against the month before, largest move first. Empty for a first month. */
  biggestChanges: BiggestChange[];
  /** Recorded shared expenses, at your share. */
  shared: { count: number; spent: number; top: TopShared | null };
  /** Recorded expenses split with others (total above your share), personal and shared. */
  split: { count: number; total: number; share: number; othersPaid: number };
  /** Days of the month up to `today` with no recorded expense, and the longest run of them (earliest on a tie). */
  daysWithoutSpending: number;
  longestRun: { start: string; end: string; days: number } | null;
}

const recordedIn = (ledger: Ledger, month: string, options: MonthOptions) => monthBreakdown(ledger, month, options);

/** The first month with a recorded entry (`YYYY-MM`), or "" for none. */
function firstRecordedMonth(ledger: Ledger, options: MonthOptions): string {
  // The first recorded month: scheduled previews never count, and income dated after today is expected.
  let first = "";
  for (const entry of ledger.transactions as OverviewEntry[]) {
    if (entry.scheduled) continue;
    if (entry.kind === "income" && entry.date > options.today) continue;
    const month = entry.date.slice(0, 7);
    if (!first || month < first) first = month;
  }
  return first;
}

function spendingByCategory(ledger: Ledger, entries: readonly Transaction[]): CategorySpending[] {
  const amounts = new Map<string, number>();
  for (const entry of entries) if (entry.kind === "expense") amounts.set(entry.categoryId, (amounts.get(entry.categoryId) ?? 0) + entry.share);
  return ledger.categories
    .filter((category) => category.kind === "expense" && (amounts.get(category.id) ?? 0) > 0)
    .map((category) => ({ id: category.id, name: category.name, icon: category.icon, color: category.color, amount: amounts.get(category.id) ?? 0 }));
}

/** The month's recap from the person's ledger view. `today` is the local date (MAZ-136). */
export function monthReview(view: Ledger, month: string, options: MonthOptions): MonthReview {
  const current = recordedIn(view, month, options);
  const first = firstRecordedMonth(view, options);
  const compare = (other: string): ComparedMonth => {
    if (!first || first > other) return { month: other, spent: null, change: null };
    const spent = recordedIn(view, other, options).recorded.expense;
    return { month: other, spent, change: percentChange(current.recorded.expense, spent) };
  };
  const previous = compare(shiftMonthKey(month, -1));
  const lastYear = compare(shiftMonthKey(month, -12));

  const biggestChanges: BiggestChange[] = previous.spent === null ? [] : categoryComparison(
    spendingByCategory(view, current.recordedEntries),
    spendingByCategory(view, recordedIn(view, previous.month, options).recordedEntries),
    null,
  )
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.change !== 0)
    .sort((a, b) => Math.abs(b.row.change) - Math.abs(a.row.change) || a.index - b.index)
    .slice(0, 3)
    .map(({ row }) => ({
      key: row.key, name: row.name, icon: row.icon, color: row.color,
      current: row.current, previous: row.previous, change: row.change,
      percent: percentChange(row.current, row.previous),
    }));

  const expenses = current.recordedEntries.filter((entry) => entry.kind === "expense");
  const shared = expenses.filter(isShared);
  const topEntry = [...shared].sort((a, b) => b.share - a.share || b.date.localeCompare(a.date) || compareKeys(a.id, b.id))[0];
  const top: TopShared | null = topEntry
    ? { id: topEntry.id, title: topEntry.title, categoryId: topEntry.categoryId, date: topEntry.date, share: topEntry.share, total: topEntry.total,
        paidByYou: topEntry.paidByYou ?? null, payer: topEntry.payer ?? null }
    : null;
  const splits = expenses.filter((entry) => entry.total > entry.share);
  const splitTotal = splits.reduce((sum, entry) => sum + entry.total, 0);
  const splitShare = splits.reduce((sum, entry) => sum + entry.share, 0);

  const { daysWithoutSpending, longestRun } = quietDays(month, expenses, options.today);
  return {
    month,
    empty: current.recordedEntries.length === 0,
    spent: current.recorded.expense,
    cameIn: current.recorded.income,
    invested: current.recorded.investment,
    leftOver: net(current.recorded),
    previous,
    lastYear,
    biggestChanges,
    shared: { count: shared.length, spent: shared.reduce((sum, entry) => sum + entry.share, 0), top },
    split: { count: splits.length, total: splitTotal, share: splitShare, othersPaid: splitTotal - splitShare },
    daysWithoutSpending,
    longestRun,
  };
}

/** Days up to `today` (the whole month once it's over) with no recorded expense. */
function quietDays(month: string, expenses: readonly Transaction[], today: string) {
  const spentOn = new Set(expenses.filter((entry) => entry.share > 0).map((entry) => entry.date));
  const { daysInMonth } = calendarMonth(month);
  let daysWithoutSpending = 0;
  let longestRun: MonthReview["longestRun"] = null;
  let runStart: string | null = null;
  let runDays = 0;
  const close = (end: string) => {
    if (runStart && runDays > (longestRun?.days ?? 0)) longestRun = { start: runStart, end, days: runDays };
    runStart = null;
    runDays = 0;
  };
  let last = "";
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    if (date > today) break;
    if (spentOn.has(date)) {
      close(last);
    } else {
      daysWithoutSpending += 1;
      runStart ??= date;
      runDays += 1;
    }
    last = date;
  }
  close(last);
  return { daysWithoutSpending, longestRun: longestRun as MonthReview["longestRun"] };
}

/**
 * The month whose recap banner shows on Home and Insights: last month, during the first 7 days of
 * this month (owner decision, 2026-11-26). Null otherwise. Dismissing it is kept on the device.
 */
export function reviewBannerMonth(today: string): string | null {
  return Number(today.slice(8, 10)) <= 7 ? shiftMonthKey(today.slice(0, 7), -1) : null;
}
