import { z } from "zod";
import type { Ledger } from "@domain/ledger.ts";
import { reviewBannerMonth, type ComparedMonth, type MonthReview, type TopShared } from "@domain/monthReview.ts";
import { monthLabel, payerName, shiftMonth, shortRange } from "../households/model";
import { isSharedEntry } from "../home/model";

/**
 * The monthly recap's wording (MAZ-292; cards `web-recap`, `web-recap-empty`, `web-home-recap`,
 * `web-insights-recap`). Every number comes from the shared rule (`src/domain/monthReview.ts`
 * `monthReview`); this module only words and lays out what it returns.
 */

/* ---------- URL state ---------- */

/** `/insights/recap?month=YYYY-MM`: a past month (the default is last month). Invalid values fall back. */
export const recapSearchSchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .refine((value) => value >= "2000-01" && value <= "2100-12")
    .optional()
    .catch(undefined),
});
export type RecapSearch = z.infer<typeof recapSearchSchema>;

/** The latest month with a recap: last month. */
export const latestRecapMonth = (today: string) => shiftMonth(today.slice(0, 7), -1);

/** The month a recap link opens: the asked month when it's over, else last month. */
export function recapMonth(month: string | undefined, today: string): string {
  const latest = latestRecapMonth(today);
  return month && month <= latest ? month : latest;
}

/** The month whose "recap is ready" banner shows, unless it was dismissed on this device. */
export function bannerMonth(today: string, dismissed: string | null): string | null {
  const month = reviewBannerMonth(today);
  return month && month !== dismissed ? month : null;
}

/* ---------- words ---------- */

/** "October" for "2026-10". */
export const monthName = (month: string) => monthLabel(month).split(" ")[0] ?? month;

/** "Oct 2025" for "2025-10". */
export const shortMonthYear = (month: string) => monthLabel(month, "short").replace(".", "");

const MINUS = "−";

/** One comparison, as the sentence words it: "4% more than September". */
function comparePhrase(compared: ComparedMonth, name: string): string | null {
  if (compared.spent === null) return null;
  if (compared.change === null) return `nothing spent in ${name}`;
  if (compared.change === 0) return `the same as ${name}`;
  return `${String(Math.abs(compared.change))}% ${compared.change > 0 ? "more" : "less"} than ${name}`;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The sentence under the spent amount (`web-recap`): "**4% more than September**, and 7% more than
 * October last year." The lead is bold. Null when there's nothing to compare with.
 */
export function spentSentence(review: MonthReview): { lead: string; rest: string } | null {
  const previous = comparePhrase(review.previous, monthName(review.previous.month));
  const lastYear = comparePhrase(review.lastYear, `${monthName(review.lastYear.month)} last year`);
  if (previous) return { lead: capitalize(previous), rest: lastYear ? `, and ${lastYear}.` : "." };
  if (lastYear) return { lead: capitalize(lastYear), rest: "." };
  return null;
}

export interface CompareBar {
  key: "current" | "previous" | "lastYear";
  label: string;
  /** Null: "No September to compare with" in place of the bar. */
  spent: number | null;
  /** The bar's length, in percent of the longest. */
  width: number;
  /** The text in place of a missing bar. */
  missing: string;
}

/** The three bars beside the spent amount: this month, the month before and the same month last year. */
export function compareBars(review: MonthReview): CompareBar[] {
  const rows: Omit<CompareBar, "width">[] = [
    { key: "current", label: monthName(review.month), spent: review.spent, missing: "" },
    { key: "previous", label: monthName(review.previous.month), spent: review.previous.spent, missing: `No ${monthName(review.previous.month)} to compare with` },
    { key: "lastYear", label: shortMonthYear(review.lastYear.month), spent: review.lastYear.spent, missing: `No ${monthLabel(review.lastYear.month)} to compare with` },
  ];
  const longest = Math.max(1, ...rows.map((row) => row.spent ?? 0));
  return rows.map((row) => ({ ...row, width: row.spent === null ? 0 : (row.spent / longest) * 100 }));
}

/** The flow bar's three parts (spent, invested, left over), in percent of what came in, or of what went out when that's more. */
export function flowParts(review: MonthReview): { spent: number; invested: number; leftOver: number } {
  const whole = Math.max(review.cameIn, review.spent + review.invested, 1);
  const percent = (value: number) => (Math.max(0, value) / whole) * 100;
  return { spent: percent(review.spent), invested: percent(review.invested), leftOver: percent(review.leftOver) };
}

/** A biggest change's chip: "New" for a category with nothing the month before, else "+18%" or "−12%". */
export function changeChip(percent: number | null): string {
  if (percent === null) return "New";
  if (percent === 0) return "0%";
  return `${percent > 0 ? "+" : MINUS}${String(Math.abs(percent))}%`;
}

/** The chip in words, for screen readers: "new", "up 18%", "down 12%". */
export function changeWords(percent: number | null): string {
  if (percent === null) return "New";
  if (percent === 0) return "No change";
  return `${percent > 0 ? "Up" : "Down"} ${String(Math.abs(percent))}%`;
}

/** "9 days without spending", "1 day without spending", "No day without spending". */
export function quietDaysTitle(days: number): string {
  if (days === 0) return "No day without spending";
  return `${String(days)} ${days === 1 ? "day" : "days"} without spending`;
}

/** "The longest run was Oct 19–22" (one day: "Oct 19"). */
export function longestRunLine(run: MonthReview["longestRun"]): string | null {
  if (!run || run.days < 2) return null;
  return `The longest run was ${shortRange(run.start, run.end)}`;
}

/** "Jo paid", "You paid", "Former member paid"; null when the projection doesn't say. */
export function paidBy(top: Pick<TopShared, "paidByYou" | "payer">): string | null {
  if (top.paidByYou) return "You paid";
  if (top.payer) return `${payerName(top.payer)} paid`;
  return null;
}

/** The household of the recap's top shared expense, from the ledger view. */
export function householdOf(view: Ledger, top: TopShared): string | null {
  const entry = view.transactions.find((item) => item.id === top.id);
  return entry && isSharedEntry(entry) ? (entry.householdName ?? null) : null;
}
