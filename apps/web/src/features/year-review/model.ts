import { z } from "zod";
import type { ExpensePayer } from "@domain/householdProjection.ts";
import type { Ledger } from "@domain/ledger.ts";
import { yearReviewBannerYear, yearReviewYear, type YearPayer, type YearReview, type YearTrip } from "@domain/yearReview.ts";
import { FORMER_MEMBER, monthLabel, payerName, shortRange } from "../households/model";

/**
 * The year in review's wording (MAZ-292 phase 2; cards `web-year-review`,
 * `web-insights-year-review`). Every number comes from the shared rule
 * (`src/domain/yearReview.ts` `yearReview`); this module only words and lays out what it returns,
 * with the names the page (never the share image) adds: trips and households.
 */

/* ---------- URL state ---------- */

/**
 * `/insights/year-review?year=YYYY`: the year to review (the latest offered by default), a number
 * in the URL, so it reads `?year=2026`. Invalid values fall back.
 */
export const yearReviewSearchSchema = z.object({
  year: z.number().int().min(2000).max(2100).optional().catch(undefined),
});
export type YearReviewSearch = z.infer<typeof yearReviewSearchSchema>;

/**
 * The latest year with a review: the year offered from December 26 to January 31
 * (`yearReviewYear`), else last year, which is over.
 */
export const latestReviewYear = (today: string) => yearReviewYear(today) ?? String(Number(today.slice(0, 4)) - 1);

/** The year a year-in-review link opens: the asked year when it's reviewable, else the latest. */
export function reviewYear(year: number | undefined, today: string): string {
  const latest = latestReviewYear(today);
  return year !== undefined && String(year) <= latest ? String(year) : latest;
}

/**
 * The year whose "in review is ready" banner shows in January, unless it was dismissed on this
 * device. While it shows, it takes the monthly recap banner's place (owner decision for web and
 * iOS: the two never stack); once dismissed, December's recap banner shows in its first 7 days.
 */
export function yearBannerYear(today: string, dismissed: string | null): string | null {
  const year = yearReviewBannerYear(today);
  return year && year !== dismissed ? year : null;
}

/* ---------- words ---------- */

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** "December" for "2026-12". */
export const monthName = (month: string) => monthLabel(month).split(" ")[0] ?? month;
/** "Dec" for "2026-12". */
export const monthShort = (month: string) => MONTHS_SHORT[Number(month.slice(5, 7)) - 1] ?? month;
/** "Saturday" for 6 (ISO weekday). */
export const weekdayName = (weekday: number) => WEEKDAYS[weekday - 1] ?? "";

const plural = (count: number, one: string, many: string) => `${String(count)} ${count === 1 ? one : many}`;

/** "Home took the biggest share of your year"; null with no spending. */
export function leadTitle(review: YearReview): string | null {
  const top = review.topCategories[0];
  return top ? `${top.name} took the biggest share of your year` : null;
}

/** "Busiest month: December"; null with no spending. */
export function busiestTitle(review: YearReview): string | null {
  return review.busiestMonth ? `Busiest month: ${monthName(review.busiestMonth.month)}` : null;
}

/** The 12 columns, each in percent of the busiest month; the busiest is highlighted. */
export function monthColumns(review: YearReview): { month: string; label: string; spent: number; height: number; busiest: boolean }[] {
  const most = Math.max(1, ...review.months.map((month) => month.spent));
  return review.months.map((month) => ({
    month: month.month,
    label: monthShort(month.month),
    spent: month.spent,
    height: (month.spent / most) * 100,
    busiest: review.busiestMonth?.month === month.month,
  }));
}

/** "3 trips, 14 days away"; "1 trip, 1 day away". */
export const tripsTitle = (review: YearReview) => `${plural(review.trips.list.length, "trip", "trips")}, ${plural(review.trips.daysAway, "day", "days")} away`;

/** The trip's name: the personal trip's, or the shared trip's household name. Null when it isn't known here. */
export function tripName(trip: YearTrip, view: Pick<Ledger, "trips">, households: readonly { id: string; name: string }[]): string | null {
  if (trip.kind === "shared") return households.find((household) => household.id === trip.id)?.name ?? null;
  return view.trips.find((item) => item.id === trip.id)?.name ?? null;
}

/** "Nov 12–19 · shared with 3", "Feb 14–16 · only you". */
export function tripLine(trip: YearTrip): string {
  return `${shortRange(trip.startDate, trip.endDate)} · ${trip.sharedWith > 0 ? `shared with ${String(trip.sharedWith)}` : "only you"}`;
}

/** "85 shared expenses". */
export const sharedTitle = (count: number) => plural(count, "shared expense", "shared expenses");

/**
 * Who paid, as the page names them: "You", the payer's name as their household shows it, or
 * "Former member" for a deleted account (never the email, `payerName`).
 */
export function payerLabel(payer: Pick<YearPayer, "you" | "payer">): string {
  if (payer.you) return "You";
  return payer.payer ? payerName(payer.payer) : FORMER_MEMBER;
}

/** "A", "A and B", "A, B and C". */
export function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1] ?? ""}`;
}

/** "Counted by who paid, in Apartment and Lisbon." from the households' names; null when none is known. */
export function countedIn(review: YearReview, households: readonly { id: string; name: string }[]): string {
  const names = review.shared.householdIds.map((id) => households.find((household) => household.id === id)?.name).filter((name): name is string => Boolean(name));
  return names.length ? `Counted by who paid, in ${listWords(names)}.` : "Counted by who paid.";
}

export interface Fact {
  key: string;
  value: string;
  label: string;
}

/** The fun facts the web card draws, in its order; a fact with nothing to say is left out. Nothing here comes from an entry's text. */
export function facts(review: YearReview): Fact[] {
  const { facts: about } = review;
  const list: Fact[] = [{ key: "quiet", value: String(about.daysWithoutSpending), label: about.daysWithoutSpending === 1 ? "day without spending" : "days without spending" }];
  const run = about.longestRun;
  if (run && run.days > 1) list.push({ key: "run", value: plural(run.days, "day", "days"), label: `longest run without spending, in ${monthName(run.start.slice(0, 7))}` });
  if (about.expensesRecorded > 0) {
    list.push({ key: "recorded", value: String(about.expensesRecorded), label: `${about.expensesRecorded === 1 ? "expense" : "expenses"} recorded, about ${String(about.perWeek)} a week` });
  }
  if (about.busiestWeekday) list.push({ key: "weekday", value: weekdayName(about.busiestWeekday), label: "the day you spent the most" });
  return list;
}

/** The initials avatar's name: the payer's name, else their email (initials only, never shown). */
export const payerAvatarName = (payer: ExpensePayer | null) => (payer ? (payer.displayName ?? payer.email) : "");
