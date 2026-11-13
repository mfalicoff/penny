import { z } from "zod";
import { calendarMonth } from "@domain/calendar.ts";
import { type Category, type Kind, type Ledger, type Transaction } from "@domain/ledger.ts";
import { buildMoneyFlow, type FlowNode, type MoneyFlow } from "@domain/selectors/moneyFlow.ts";
import { selectOverview, type OverviewEntry } from "@domain/selectors/overview.ts";
import { isExpected, net, type KindTotals } from "@domain/summary.ts";
import type { SharedRow } from "../../api/projection";

/**
 * Home and Insights reporting (MAZ-92). Every number comes from the shared domain
 * (`src/domain/summary.ts` `monthBreakdown`, `selectors/overview.ts`, `selectors/moneyFlow.ts`),
 * the same rules the legacy Overview and the iOS app use. This module only:
 *
 * - joins the person's shared-expense shares into a read-only view of their ledger, the way the
 *   legacy `ledgerWithHouseholds` does, so the domain can deduplicate shared previews (MAZ-139);
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
 * Home's search parameters. `month` (`YYYY-MM`, default this month), and the Explore your month
 * list's filters: `day` (`YYYY-MM-DD` inside the month), `q` (keyword), `kind` and `category`.
 * The month's totals never follow `day`, `q`, `kind` or `category`.
 */
export const homeSearchSchema = z.object({
  month: monthParam,
  day: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
    .optional()
    .catch(undefined),
  q: z.string().trim().max(200).optional().catch(undefined),
  kind: z.enum(["expense", "income", "investment"]).optional().catch(undefined),
  category: z.string().min(1).max(200).optional().catch(undefined),
});
export type HomeSearch = z.infer<typeof homeSearchSchema>;

export const insightsSearchSchema = z.object({ month: monthParam });
export type InsightsSearch = z.infer<typeof insightsSearchSchema>;

/* ---------- the ledger view ---------- */

/** A shared share in the ledger view. `householdId` lets the domain match a recorded row with its preview. */
export type SharedEntry = OverviewEntry & { householdId: string; householdExpenseId: string; householdName?: string | undefined };

export const isSharedEntry = (entry: Transaction): entry is SharedEntry => "householdExpenseId" in entry;

/** The category id a shared row gets in the view: shared categories travel by value. */
export const sharedCategoryId = (category: SharedRow["category"]) => `household-category:${category.name}:${category.icon}:${category.color}`;

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
    const categoryId = sharedCategoryId(row.category);
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
  /** Recorded and scheduled entries of the month, for the calendar and the list. */
  calendarEntries: OverviewEntry[];
  empty: boolean;
}

const byDateAscThenId = (a: Transaction, b: Transaction) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
const byDateDescThenId = (a: Transaction, b: Transaction) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id);

/**
 * The month's report from the ledger view. Every total is independent of the list's filters.
 * `today` (the local date) makes income dated after it expected (MAZ-136); Home always passes it.
 */
export function monthReport(view: Ledger, month: string, today?: string): MonthReport {
  const overview = selectOverview(view, { month, day: null, filter: "all", categoryId: null, search: "", ...(today === undefined ? {} : { today }) });
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
    // iOS flow, so Left over always matches it. Not the legacy `moneyFlowEntries` (MAZ-136).
    flow: buildMoneyFlow(overview.monthEntries, view.categories),
    spending: overview.spending,
    calendarEntries: overview.calendarEntries,
    empty: overview.calendarEntries.length === 0,
  };
}

/* ---------- the Explore your month list ---------- */

export interface ListFilters {
  day: string | undefined;
  q: string | undefined;
  kind: Kind | undefined;
  category: string | undefined;
}

/** The list under the calendar: the domain's filter (day, kind, category, the shared substring search), newest first. */
export function monthEntries(view: Ledger, month: string, filters: ListFilters): OverviewEntry[] {
  const day = filters.day?.startsWith(`${month}-`) ? filters.day : null;
  return selectOverview(view, { month, day, filter: filters.kind ?? "all", categoryId: filters.category ?? null, search: filters.q ?? "" }).visibleEntries;
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
 * ("expected or scheduled"): an amber ring, never a recorded dot.
 */
export function calendarDays(month: string, entries: readonly OverviewEntry[], today?: string): { offset: number; days: CalendarDay[] } {
  const { daysInMonth, offset } = calendarMonth(month);
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
  return node.color;
}

/** What a flow node means, in words, for its accessible name and the focus card. */
export function flowNodeSummary(node: FlowNode, flow: MoneyFlow, side: "in" | "out"): string {
  if (node.id === "balance:gap") return "spent beyond what came in";
  if (node.id === "balance:remaining") return `${String(percentOf(node.amount, flow.income))}% of what came in, left over`;
  if (side === "in") return `${String(percentOf(node.amount, flow.income))}% of what came in`;
  const outflow = flow.expense + flow.investment;
  return `${String(percentOf(node.amount, flow.income))}% of what came in, ${String(percentOf(node.amount, outflow))}% of what went out`;
}

/** Shortens a long label for the chart (the full text stays in its accessible name and the table). */
export function shortLabel(label: string, max = 18): string {
  const chars = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(label), (part) => part.segment);
  return chars.length <= max ? label : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}
