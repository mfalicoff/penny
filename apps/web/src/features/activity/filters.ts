import { z } from "zod";
import type { Kind } from "@domain/ledger.ts";
import type { ProjectionPeriod } from "../../api/projection";
import { monthRange, type SearchFilters } from "../../api/search";
import { monthLabel, shiftMonth } from "../households/model";

/**
 * Activity's filters live in the URL (`/transactions?q=…&month=…`), so a filtered view can be
 * bookmarked, shared and restored with Back and Forward. Every field falls back on a bad value
 * (`.catch`), so old or hand-edited links still open.
 *
 * - `q`: keyword search (server search online, this browser's ledger offline).
 * - `month` (`YYYY-MM`) or `year` (`YYYY`): the period. Neither means all time. `month` wins over `year`.
 * - `day` (`YYYY-MM-DD`): only that day. Without a period it implies its month.
 * - `kind`: expenses, income or investments.
 * - `category`: a personal category id; shared rows match by its name.
 *
 * Totals follow the period only, never `q`, `day`, `kind` or `category`.
 */
export const activitySearchSchema = z.object({
  q: z.string().trim().max(200).optional().catch(undefined),
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional()
    .catch(undefined),
  year: z
    .string()
    .regex(/^(20\d\d|2100)$/)
    .optional()
    .catch(undefined),
  day: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
    .optional()
    .catch(undefined),
  kind: z.enum(["expense", "income", "investment"]).optional().catch(undefined),
  category: z.string().min(1).max(100).optional().catch(undefined),
});

export type ActivitySearch = z.infer<typeof activitySearchSchema>;

/** `search` without `keys`, for dropping filters from the URL. */
export function without(search: ActivitySearch, ...keys: (keyof ActivitySearch)[]): ActivitySearch {
  return Object.fromEntries(Object.entries(search).filter(([key]) => !keys.includes(key as keyof ActivitySearch)));
}

export type Period = { type: "month"; month: string } | { type: "year"; year: string } | { type: "all" };

export function periodOf(search: ActivitySearch): Period {
  if (search.month) return { type: "month", month: search.month };
  if (search.year) return { type: "year", year: search.year };
  if (search.day) return { type: "month", month: search.day.slice(0, 7) };
  return { type: "all" };
}

/** The day filter only applies inside the period; a day outside it is ignored. */
export function activeDay(search: ActivitySearch): string | undefined {
  const { day } = search;
  if (!day) return undefined;
  const period = periodOf(search);
  if (period.type === "month") return day.startsWith(`${period.month}-`) ? day : undefined;
  if (period.type === "year") return day.startsWith(`${period.year}-`) ? day : undefined;
  return day;
}

export function periodRange(period: Period): Pick<SearchFilters, "from" | "to"> {
  if (period.type === "month") return monthRange(period.month);
  if (period.type === "year") return { from: `${period.year}-01-01`, to: `${period.year}-12-31` };
  return {};
}

/** The date range a search uses: the active day, or else the period. */
export function searchRange(search: ActivitySearch): Pick<SearchFilters, "from" | "to"> {
  const day = activeDay(search);
  return day ? { from: day, to: day } : periodRange(periodOf(search));
}

export function inPeriod(date: string, period: Period): boolean {
  if (period.type === "month") return date.startsWith(`${period.month}-`);
  if (period.type === "year") return date.startsWith(`${period.year}-`);
  return true;
}

export function periodLabel(period: Period): string {
  if (period.type === "month") return monthLabel(period.month);
  if (period.type === "year") return period.year;
  return "All time";
}

export function projectionPeriod(period: Period): ProjectionPeriod {
  if (period.type === "month") return { month: period.month };
  if (period.type === "year") return { year: period.year };
  return {};
}

/** The search parameters for the neighbouring period. The day filter is dropped; it belonged to the old period. */
export function shiftPeriod(search: ActivitySearch, delta: number): ActivitySearch {
  const period = periodOf(search);
  const rest = without(search, "day", "month", "year");
  if (period.type === "month") {
    const month = shiftMonth(period.month, delta);
    return month < "2000-01" || month > "2100-12" ? search : { ...rest, month };
  }
  if (period.type === "year") {
    const year = String(Number(period.year) + delta);
    return year < "2000" || year > "2100" ? search : { ...rest, year };
  }
  return search;
}

export function withPeriod(search: ActivitySearch, type: Period["type"], now = new Date()): ActivitySearch {
  const rest = without(search, "day", "month", "year");
  const current = periodOf(search);
  const thisMonth = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (type === "month") return { ...rest, month: current.type === "year" ? `${current.year}-${thisMonth.slice(5)}` : thisMonth };
  if (type === "year") return { ...rest, year: current.type === "month" ? current.month.slice(0, 4) : thisMonth.slice(0, 4) };
  return rest;
}

export const KIND_FILTERS: { value: "all" | Kind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "expense", label: "Expenses" },
  { value: "income", label: "Income" },
  { value: "investment", label: "Investments" },
];
