import { z } from "zod";
import { calendarMonth } from "@domain/calendar.ts";
import { type Category, type Ledger, type Transaction } from "@domain/ledger.ts";
import { buildMoneyFlow, type FlowNode, type MoneyFlow } from "@domain/selectors/moneyFlow.ts";
import { selectOverview, type OverviewEntry } from "@domain/selectors/overview.ts";
import { sharedCategoryId } from "@domain/householdProjection.ts";
import { isExpected, net, type KindTotals } from "@domain/summary.ts";
import type { SharedRow } from "../../api/projection";
import type { WeekStart } from "../../app/preferences";
import type { IconName } from "../../design/Icon";
import { categoryTint } from "../../design/categoryTint";
import { categoryIcon } from "../entries/model";
import { shiftMonth } from "../households/model";

/**
 * Home and Insights reporting (MAZ-92). Every number comes from the shared domain
 * (`src/domain/summary.ts` `monthBreakdown`, `selectors/overview.ts`, `selectors/moneyFlow.ts`),
 * the same rules the iOS app uses. This module only:
 *
 * - joins the person's shared-expense shares into a read-only view of their ledger, the way the
 *   domain's `ledgerWithHouseholds` (`src/domain/householdProjection.ts`) does, so the domain can
 *   deduplicate shared previews (MAZ-139);
 * - groups and labels the results for the screens (small categories, calendar days, comparisons).
 *
 * Nothing here is stored or sent: the view never reaches the offline store or `PUT /api/ledger`.
 */

/* ---------- URL state ---------- */

const monthParam = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .refine((value) => value >= "2000-01" && value <= "2100-12")
  .optional()
  .catch(undefined);

/**
 * Home's search parameters. `month` (`YYYY-MM`, default this month) and `day` (`YYYY-MM-DD`),
 * which opens the calendar sheet on that day. The month's totals never follow `day`. Older links'
 * list filters (`q`, `kind`, `category`, MAZ-224) are dropped.
 */
export const homeSearchSchema = z.object({
  month: monthParam,
  day: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
    .optional()
    .catch(undefined),
});
export type HomeSearch = z.infer<typeof homeSearchSchema>;

export const insightsSearchSchema = z.object({ month: monthParam });
export type InsightsSearch = z.infer<typeof insightsSearchSchema>;

/* ---------- the ledger view ---------- */

/** A shared share in the ledger view. `householdId` lets the domain match a recorded row with its preview. */
export type SharedEntry = OverviewEntry & { householdId: string; householdExpenseId: string; householdName?: string | undefined };

export const isSharedEntry = (entry: Transaction): entry is SharedEntry => "householdExpenseId" in entry;

/**
 * The person's ledger with their shares of shared expenses added: recorded shares (`rows`) and
 * the month's shared previews (`scheduled`, flagged `scheduled: true`). Rows in another
 * currency than the ledger's, or whose currency isn't known, are left out, as in Activity.
 */
export function ledgerWithShared(ledger: Ledger, rows: readonly SharedRow[], scheduled: readonly SharedRow[]): Ledger {
  if (!rows.length && !scheduled.length) return ledger;
  const categories: Category[] = [...ledger.categories];
  const known = new Set(categories.map((category) => category.id));
  const transactions: Transaction[] = [...ledger.transactions];
  const add = (row: SharedRow, preview: boolean) => {
    if (row.householdCurrency !== ledger.currency) return;
    // Counted under the person's expense category of the same name, as the domain's
    // `ledgerWithHouseholds` does; a shared category with no match keeps its own row.
    const categoryId = sharedCategoryId(ledger.categories, row.category);
    if (!known.has(categoryId)) {
      known.add(categoryId);
      categories.push({ id: categoryId, kind: "expense", ...row.category });
    }
    const entry: SharedEntry = {
      id: `household:${row.householdId}:${row.id}`,
      householdId: row.householdId,
      householdExpenseId: row.id,
      householdName: row.householdName,
      kind: "expense",
      title: row.title,
      date: row.date,
      total: row.totalCents,
      share: row.shareCents,
      categoryId,
      note: row.note,
      accountId: row.accountId,
      ...(row.recurringId ? { recurringId: row.recurringId } : {}),
      ...(preview || row.scheduled ? { scheduled: true } : {}),
    };
    transactions.push(entry);
  };
  for (const row of rows) add(row, false);
  for (const row of scheduled) add(row, true);
  return { ...ledger, categories, transactions };
}

/* ---------- the month ---------- */

export interface MonthReport {
  month: string;
  /** Entries recorded this month (personal and shared), newest first. */
  recordedEntries: OverviewEntry[];
  /**
   * What the month still expects, soonest first: scheduled occurrences not recorded yet (personal
   * and shared) and income dated after today (MAZ-136), which counts toward Projected only.
   */
  comingUp: OverviewEntry[];
  recorded: KindTotals;
  projected: KindTotals;
  /** Scheduled income not recorded yet plus income dated after today (part of projected). */
  expectedIncome: number;
  /** Income − expenses − investments of recorded entries ("Left to spend"). Negative means overspent. */
  recordedNet: number;
  /** The same with every scheduled occurrence of the month added. */
  projectedNet: number;
  /** Your share of recorded shared expenses, already in `recorded.expense`. */
  sharedSpent: number;
  sharedCount: number;
  /** The recorded month's money flow: what came in and where it went. Never includes expected income. */
  flow: MoneyFlow;
  /** Recorded spending by category, largest first. */
  spending: (Category & { amount: number })[];
  /** Recorded and scheduled entries of the month, for the calendar sheet. */
  calendarEntries: OverviewEntry[];
  empty: boolean;
}

const byDateAscThenId = (a: Transaction, b: Transaction) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
const byDateDescThenId = (a: Transaction, b: Transaction) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id);

/**
 * The month's report from the ledger view.
 * `today` (the local date) makes income dated after it expected (MAZ-136).
 */
export function monthReport(view: Ledger, month: string, today: string): MonthReport {
  const overview = selectOverview(view, { month, day: null, filter: "all", categoryId: null, search: "", today });
  const recordedEntries = [...overview.monthEntries].sort(byDateDescThenId);
  const shared = recordedEntries.filter(isSharedEntry);
  return {
    month,
    recordedEntries,
    comingUp: [...overview.expected, ...overview.scheduled].sort(byDateAscThenId),
    recorded: overview.recorded,
    projected: overview.summary,
    expectedIncome: overview.expectedIncome,
    recordedNet: net(overview.recorded),
    projectedNet: net(overview.summary),
    sharedSpent: shared.reduce((sum, entry) => sum + entry.share, 0),
    sharedCount: shared.length,
    // Recorded entries only (personal and shared, at your share), like Left to spend and the native
    // iOS flow, so Left over always matches it (MAZ-136).
    flow: buildMoneyFlow(overview.monthEntries, view.categories),
    spending: overview.spending,
    calendarEntries: overview.calendarEntries,
    empty: overview.calendarEntries.length === 0,
  };
}

/* ---------- small-category grouping ---------- */

export type CategoryShare = { id: string; name: string; icon: string; color: string; amount: number; count?: number };

/**
 * The largest `limit` categories, and the rest summed into one "N more" row, so every cent is
 * still shown. With `limit + 1` or fewer categories nothing is grouped (a single leftover would
 * just be renamed).
 */
export function groupSmall(spending: readonly (Category & { amount: number })[], limit = 5): { rows: CategoryShare[]; total: number } {
  const total = spending.reduce((sum, category) => sum + category.amount, 0);
  const sorted = [...spending].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  if (sorted.length <= limit + 1) return { rows: sorted, total };
  const rest = sorted.slice(limit);
  return {
    rows: [
      ...sorted.slice(0, limit),
      { id: "more", name: `${String(rest.length)} more`, icon: "ellipsis-horizontal", color: "", amount: rest.reduce((sum, category) => sum + category.amount, 0), count: rest.length },
    ],
    total,
  };
}

/** Whole percent of `part` in `whole` (0 when there is no whole). */
export const percentOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/* ---------- calendar ---------- */

export interface CalendarDay {
  date: string;
  day: number;
  count: number;
  expense: number;
  income: number;
  investment: number;
  /** Expected or scheduled entries on the day: scheduled previews and income dated after today (the amber ring). */
  scheduled: number;
}

/**
 * The month's days with what happened on each, built in one pass over the entries (no per-cell
 * scans). Scheduled occurrences and income dated after `today` (MAZ-136) count as `scheduled`
 * ("expected or scheduled"): an amber ring, never a recorded dot. `offset` is the number of
 * blank cells before the 1st, for a week starting on `weekStartsOn` (Settings › Appearance, MAZ-140).
 */
export function calendarDays(
  month: string,
  entries: readonly OverviewEntry[],
  today: string,
  weekStartsOn: WeekStart = "monday",
): { offset: number; days: CalendarDay[] } {
  const { daysInMonth, offset: mondayOffset } = calendarMonth(month);
  const offset = weekStartsOn === "sunday" ? (mondayOffset + 1) % 7 : mondayOffset;
  const days: CalendarDay[] = Array.from({ length: daysInMonth }, (_, index) => ({
    date: `${month}-${String(index + 1).padStart(2, "0")}`,
    day: index + 1,
    count: 0,
    expense: 0,
    income: 0,
    investment: 0,
    scheduled: 0,
  }));
  for (const entry of entries) {
    if (!entry.date.startsWith(`${month}-`)) continue;
    const day = days[Number(entry.date.slice(8)) - 1];
    if (!day) continue;
    day.count += 1;
    if (isExpected(entry, today)) day.scheduled += 1;
    else day[entry.kind] += entry.share;
  }
  return { offset, days };
}

/* ---------- Insights ---------- */

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

/**
 * This month's spending by category next to last month's. Categories match by name (shared
 * categories travel by value, and the same name is the same category to the person); small ones
 * beyond `limit` are summed into "N more".
 */
export function categoryComparison(current: readonly (Category & { amount: number })[], previous: readonly (Category & { amount: number })[], limit = 8): CategoryChange[] {
  const rows = new Map<string, CategoryChange>();
  const keyOf = (name: string) => name.trim().toLowerCase();
  for (const [list, field] of [
    [current, "current"],
    [previous, "previous"],
  ] as const) {
    for (const category of list) {
      const key = keyOf(category.name);
      const row = rows.get(key) ?? { key, name: category.name, icon: category.icon, color: category.color, current: 0, previous: 0, change: 0, share: 0 };
      row[field] += category.amount;
      rows.set(key, row);
    }
  }
  const total = current.reduce((sum, category) => sum + category.amount, 0);
  const sorted = [...rows.values()]
    .map((row) => ({ ...row, change: row.current - row.previous, share: percentOf(row.current, total) }))
    .sort((a, b) => b.current - a.current || b.previous - a.previous || a.key.localeCompare(b.key));
  if (sorted.length <= limit + 1) return sorted;
  const rest = sorted.slice(limit);
  const sum = (field: "current" | "previous") => rest.reduce((value, row) => value + row[field], 0);
  const more = { key: "more", name: `${String(rest.length)} more`, icon: "ellipsis-horizontal", color: "", current: sum("current"), previous: sum("previous"), change: 0, share: 0 };
  return [...sorted.slice(0, limit), { ...more, change: more.current - more.previous, share: percentOf(more.current, total) }];
}

/* ---------- money flow ---------- */

/** Meaning colors for the flow's own nodes (tokens), so they follow the appearance; categories keep their color. */
export function flowColor(node: FlowNode): string {
  if (node.id === "investment:total") return "var(--pk-invest)";
  if (node.id === "balance:remaining") return "var(--pk-income)";
  if (node.id === "balance:gap") return "var(--pk-danger)";
  if (node.id.endsWith(":overflow")) return "var(--pk-c-other)";
  // MAZ-222: expense categories draw in the redesign palette, never copper; income sources keep their stored color (MAZ-223).
  if (node.id.startsWith("expense:")) return categoryTint({ id: node.id.slice("expense:".length), color: node.color });
  return node.color;
}

/**
 * What a flow node means, in words, for its accessible name and the focus card, as the card
 * `iphone-money-flow` words it: "45% of income · 77% of spending" for a category (its share of
 * what came in and of the month's spending), "6% of income" for the rest.
 */
export function flowNodeSummary(node: FlowNode, flow: MoneyFlow, side: "in" | "out"): string {
  if (node.id === "balance:gap") return "spent beyond income";
  const income = `${String(percentOf(node.amount, flow.income))}% of income`;
  if (side === "in" || !node.id.startsWith("expense:")) return income;
  return `${income} · ${String(percentOf(node.amount, flow.expense))}% of spending`;
}

/** The focus card's icon for a flow node: the category's own icon, or one for what the node is. */
export function flowNodeIcon(node: FlowNode, categories: readonly Pick<Category, "id" | "icon">[]): IconName {
  if (node.id === "investment:total") return "trending-up";
  if (node.id === "balance:remaining") return "wallet";
  if (node.id === "balance:gap") return "alert-circle";
  if (node.id.endsWith(":overflow")) return "ellipsis-horizontal";
  const [kind = "", id = ""] = node.id.split(":");
  const category = categories.find((item) => item.id === id);
  if (category?.icon) return categoryIcon(category.icon);
  return kind === "income" ? "arrow-down" : "pricetag";
}

/**
 * The chart's label for a node. The flow groups the smallest categories past the fifth as "Other
 * <kind> categories", which is too long for the chart and would be shortened; its short form
 * ("Other expenses") fits, so the drawn text stays a whole part of the node's accessible name.
 */
export function flowLabel(node: FlowNode): string {
  const [kind = "", id = ""] = node.id.split(":");
  if (id !== "overflow") return node.label;
  return kind === "expense" ? "Other expenses" : `Other ${kind}`;
}

/** Shortens a long label for the chart (the full text stays in its accessible name and the table). */
export function shortLabel(label: string, max = 18): string {
  const chars = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(label), (part) => part.segment);
  return chars.length <= max ? label : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/**
 * Insights' month-over-month sentence (card `iphone-insights`): the change in recorded spending
 * from last month, and the (at most two) categories that moved most in that direction ("Mostly
 * Food & drinks and Shopping."). The grouped "N more" row is never named.
 */
export function spendingChange(current: number, previous: number, comparison: readonly CategoryChange[]): { delta: number; drivers: string[] } {
  const delta = current - previous;
  if (delta === 0) return { delta, drivers: [] };
  const drivers = comparison
    .filter((row) => row.key !== "more" && Math.sign(row.change) === Math.sign(delta))
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 2)
    .map((row) => row.name);
  return { delta, drivers };
}

/** The months ending with `month`, oldest first (Insights' six-month chart). */
export function monthsEnding(month: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => shiftMonth(month, index - count + 1));
}
