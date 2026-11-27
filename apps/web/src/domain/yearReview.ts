import { isHouseholdTransaction, type ExpensePayer, type Household } from "./householdProjection.ts";
import type { Ledger, Transaction } from "./ledger.ts";
import { categoryComparison, percentOf, type CategorySpending } from "./monthReview.ts";
import { monthBreakdown, type MonthOptions, type OverviewEntry } from "./summary.ts";

/**
 * The year in review (MAZ-292, phase 2): a year's recorded numbers, computed from its 12 months the
 * same way on every platform. The reference for the Swift rule (`PennyDomain/Ledger/YearReview.swift`)
 * and `contracts/fixtures/year-review.json`.
 *
 * Input is the person's ledger view with their shared shares joined in (`ledgerWithHouseholds`),
 * as for `monthReview`: shared expenses count at the person's share, shared rows in another
 * currency are already left out, and only recorded entries count (`monthBreakdown`), never
 * scheduled previews. `households` are the person's households (`GET /api/households`), for the
 * shared trips and the households where shared expenses were paid.
 *
 * Days are counted from January 1, or from the first recorded entry in a first year, up to today
 * (the whole year once it's over), so a first year never counts the months before Penny.
 *
 * Nothing here reads titles, notes or receipts: the share card is built from this result alone.
 */

export interface YearReviewOptions extends MonthOptions {
  /** The person's households; only `id`, `memberCount` and `trip` are read. */
  households: readonly Pick<Household, "id" | "memberCount" | "trip">[];
}

export interface YearMonth {
  month: string;
  spent: number;
}

export interface YearCategory {
  key: string;
  name: string;
  icon: string;
  color: string;
  amount: number;
  /** Whole percent of the year's spending. */
  share: number;
}

export interface YearTrip {
  /** The personal trip's id, or the shared trip's household id. */
  id: string;
  kind: "personal" | "shared";
  startDate: string;
  endDate: string;
  /** Days of the trip in the counted range, from `from` up to `to`. */
  days: number;
  /** Your recorded share of the trip's expenses dated in the year. */
  share: number;
  /** Others on a shared trip (its members but you); 0 for a personal trip ("only you"). */
  sharedWith: number;
}

export interface YearPayer {
  /** "you", or the payer's email in lower case. */
  key: string;
  /** True for your own row. */
  you: boolean;
  /** Who paid as the household sees them (null for you): a deleted account shows "Former member". */
  payer: ExpensePayer | null;
  count: number;
  /** Households the payer paid in, most expenses first (then by id). */
  householdIds: string[];
}

export interface YearReview {
  year: string;
  /** No recorded entry in the year (only scheduled entries counts as none). */
  empty: boolean;
  /** The first counted day: January 1, or the first recorded entry in a first year. Null with none up to today. */
  from: string | null;
  /** The last counted day: December 31, or today while the year is under way. */
  to: string;
  spent: number;
  /** All 12 months, January first. */
  months: YearMonth[];
  /** The month with the most recorded spending (the earliest on a tie); null with no spending. */
  busiestMonth: YearMonth | null;
  /** Spending over the counted months (from `from` to `to`), rounded half up to whole cents. */
  monthlyAverage: number;
  /** Up to five categories, largest first, matched by name as in the recap. */
  topCategories: YearCategory[];
  trips: {
    /** Trips with days in the year, your largest share first. */
    list: YearTrip[];
    /** Days on any trip, each day once. */
    daysAway: number;
    share: number;
    /** The longest trip (the costlier, then the earlier, on a tie), and the costliest (the longer, then the earlier). */
    longestId: string | null;
    costliestId: string | null;
  };
  shared: {
    /** Recorded shared expenses in the year. */
    count: number;
    /** Whole percent of them you paid for. */
    paidByYouPercent: number;
    /** Counted by who paid, most first, you before others on a tie; rows with no known payer are left out. */
    payers: YearPayer[];
    /** Households of the shared expenses, most expenses first (then by id). */
    householdIds: string[];
    /** Of the expenses split with others (total above your share), what others paid: total − share. */
    othersPaid: number;
  };
  facts: {
    daysWithoutSpending: number;
    longestRun: { start: string; end: string; days: number } | null;
    expensesRecorded: number;
    /** Expenses a week over the counted days, rounded half up; 0 with no counted day. */
    perWeek: number;
    /** ISO weekday (1 Monday … 7 Sunday) with the most spending, the earliest on a tie; null with none. */
    busiestWeekday: number | null;
    /** The category with the most recorded expenses (the larger amount, then the key, on a tie). */
    mostFrequentCategory: { key: string; name: string; icon: string; color: string; count: number } | null;
  };
}

const compareKeys = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const categoryKey = (name: string) => name.trim().toLowerCase();

const DAY = 86_400_000;
const utc = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
const dateOf = (time: number) => new Date(time).toISOString().slice(0, 10);
/** Days from `start` to `end`, both included; 0 when `end` is before `start`. */
const daysBetween = (start: string, end: string) => (end < start ? 0 : Math.round((utc(end) - utc(start)) / DAY) + 1);
const earlier = (a: string, b: string) => (a < b ? a : b);
const later = (a: string, b: string) => (a > b ? a : b);

/** The first recorded entry's date ("" for none): previews never count, and income dated after today is expected. */
function firstRecordedDate(ledger: Ledger, today: string): string {
  let first = "";
  for (const entry of ledger.transactions as OverviewEntry[]) {
    if (entry.scheduled) continue;
    if (entry.kind === "income" && entry.date > today) continue;
    if (!first || entry.date < first) first = entry.date;
  }
  return first;
}

/** Rank keys by count, most first, then by key. */
const ranked = (counts: Map<string, number>) =>
  [...counts.entries()].sort((a, b) => b[1] - a[1] || compareKeys(a[0], b[0])).map(([key]) => key);

/** The year in review of `year` (`YYYY`) from the person's ledger view. `today` is the local date. */
export function yearReview(view: Ledger, year: string, options: YearReviewOptions): YearReview {
  const { today } = options;
  const months: YearMonth[] = [];
  const recorded: Transaction[] = [];
  for (let index = 1; index <= 12; index += 1) {
    const month = `${year}-${String(index).padStart(2, "0")}`;
    const breakdown = monthBreakdown(view, month, { today });
    months.push({ month, spent: breakdown.recorded.expense });
    recorded.push(...breakdown.recordedEntries);
  }
  const expenses = recorded.filter((entry) => entry.kind === "expense");
  const spent = months.reduce((sum, month) => sum + month.spent, 0);
  const busiest = months.reduce<YearMonth | null>((best, month) => (month.spent > (best?.spent ?? 0) ? month : best), null);

  const first = firstRecordedDate(view, today);
  const to = earlier(`${year}-12-31`, today);
  const from = first && first <= to ? later(`${year}-01-01`, first) : null;
  const countedDays = from ? daysBetween(from, to) : 0;
  const countedMonths = from ? (Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1) : 0;

  /* ---------- categories ---------- */
  const amounts = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const entry of expenses) {
    amounts.set(entry.categoryId, (amounts.get(entry.categoryId) ?? 0) + entry.share);
    counts.set(entry.categoryId, (counts.get(entry.categoryId) ?? 0) + 1);
  }
  const categories = view.categories.filter((category) => category.kind === "expense");
  const spending: CategorySpending[] = categories
    .filter((category) => (amounts.get(category.id) ?? 0) > 0)
    .map((category) => ({ id: category.id, name: category.name, icon: category.icon, color: category.color, amount: amounts.get(category.id) ?? 0 }));
  const topCategories = categoryComparison(spending, [], null)
    .slice(0, 5)
    .map(({ key, name, icon, color, current, share }) => ({ key, name, icon, color, amount: current, share }));

  // The most frequent category, matched by name as the comparison does.
  const frequent = new Map<string, { key: string; name: string; icon: string; color: string; count: number; amount: number }>();
  for (const category of categories) {
    const count = counts.get(category.id) ?? 0;
    if (!count) continue;
    const key = categoryKey(category.name);
    const row = frequent.get(key) ?? { key, name: category.name, icon: category.icon, color: category.color, count: 0, amount: 0 };
    row.count += count;
    row.amount += amounts.get(category.id) ?? 0;
    frequent.set(key, row);
  }
  const mostFrequent = [...frequent.values()].sort((a, b) => b.count - a.count || b.amount - a.amount || compareKeys(a.key, b.key))[0];

  /* ---------- trips ---------- */
  // Days of a trip in the counted range (none before the first recorded entry, nor after today).
  const inYear = (start: string, end: string) => (from ? daysBetween(later(start, from), earlier(end, to)) : 0);
  const sharedTrips = options.households.filter((household) => household.trip);
  const sharedIds = new Set(sharedTrips.map((household) => household.id));
  const trips: (YearTrip & { tripIds: Set<string> })[] = [];
  for (const household of sharedTrips) {
    const trip = household.trip!;
    const linked = view.trips.filter((item) => item.sharedHouseholdId === household.id).map((item) => item.id);
    trips.push({ id: household.id, kind: "shared", startDate: trip.startDate, endDate: trip.endDate, days: inYear(trip.startDate, trip.endDate), share: 0,
      sharedWith: Math.max(household.memberCount - 1, 0), tripIds: new Set(linked) });
  }
  for (const trip of view.trips) {
    // A personal trip linked to a shared trip you can still see is counted with it, never twice.
    if (trip.sharedHouseholdId && sharedIds.has(trip.sharedHouseholdId)) continue;
    trips.push({ id: trip.id, kind: "personal", startDate: trip.startDate, endDate: trip.endDate, days: inYear(trip.startDate, trip.endDate), share: 0,
      sharedWith: 0, tripIds: new Set([trip.id]) });
  }
  for (const entry of expenses) {
    const trip = trips.find((item) => isHouseholdTransaction(entry)
      ? item.kind === "shared" && item.id === entry.householdId
      : entry.tripId !== undefined && item.tripIds.has(entry.tripId));
    if (trip) trip.share += entry.share;
  }
  const tripList: YearTrip[] = trips
    .filter((trip) => trip.days > 0)
    .map(({ tripIds: _, ...trip }) => trip)
    .sort((a, b) => b.share - a.share || b.days - a.days || compareKeys(a.startDate, b.startDate) || compareKeys(a.id, b.id));
  const away = new Set<string>();
  for (const trip of tripList) {
    for (let time = utc(later(trip.startDate, from ?? to)); time <= utc(earlier(trip.endDate, to)); time += DAY) away.add(dateOf(time));
  }
  const pick = (compare: (a: YearTrip, b: YearTrip) => number) => [...tripList].sort((a, b) => compare(a, b) || compareKeys(a.startDate, b.startDate) || compareKeys(a.id, b.id))[0]?.id ?? null;

  /* ---------- who paid ---------- */
  const shared = expenses.filter(isHouseholdTransaction);
  const payers = new Map<string, YearPayer & { households: Map<string, number> }>();
  const households = new Map<string, number>();
  let paidByYou = 0;
  for (const entry of shared) {
    households.set(entry.householdId, (households.get(entry.householdId) ?? 0) + 1);
    const you = entry.paidByYou === true;
    if (you) paidByYou += 1;
    if (!you && !entry.payer) continue;
    const key = you ? "you" : entry.payer!.email.toLowerCase();
    const row = payers.get(key) ?? { key, you, payer: you ? null : entry.payer!, count: 0, householdIds: [], households: new Map<string, number>() };
    row.count += 1;
    row.households.set(entry.householdId, (row.households.get(entry.householdId) ?? 0) + 1);
    payers.set(key, row);
  }
  const payerList: YearPayer[] = [...payers.values()]
    .sort((a, b) => b.count - a.count || Number(b.you) - Number(a.you) || compareKeys(a.key, b.key))
    .map(({ households: paidIn, ...row }) => ({ ...row, householdIds: ranked(paidIn) }));
  const splits = expenses.filter((entry) => entry.total > entry.share);

  /* ---------- facts ---------- */
  const spentOn = new Map<string, number>();
  for (const entry of expenses) if (entry.share > 0) spentOn.set(entry.date, (spentOn.get(entry.date) ?? 0) + entry.share);
  let daysWithoutSpending = 0;
  let longestRun: YearReview["facts"]["longestRun"] = null;
  let runStart: string | null = null;
  let runDays = 0;
  let last = "";
  const close = () => {
    if (runStart && runDays > (longestRun?.days ?? 0)) longestRun = { start: runStart, end: last, days: runDays };
    runStart = null;
    runDays = 0;
  };
  if (from) {
    for (let time = utc(from); time <= utc(to); time += DAY) {
      const date = dateOf(time);
      if (spentOn.has(date)) {
        close();
      } else {
        daysWithoutSpending += 1;
        runStart ??= date;
        runDays += 1;
      }
      last = date;
    }
    close();
  }
  const weekdays = new Map<number, number>();
  for (const [date, amount] of spentOn) {
    const weekday = ((new Date(utc(date)).getUTCDay() + 6) % 7) + 1;
    weekdays.set(weekday, (weekdays.get(weekday) ?? 0) + amount);
  }
  const busiestWeekday = [...weekdays.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;

  return {
    year,
    empty: recorded.length === 0,
    from,
    to,
    spent,
    months,
    busiestMonth: busiest ? { ...busiest } : null,
    monthlyAverage: countedMonths > 0 ? Math.round(spent / countedMonths) : 0,
    topCategories,
    trips: {
      list: tripList,
      daysAway: away.size,
      share: tripList.reduce((sum, trip) => sum + trip.share, 0),
      longestId: pick((a, b) => b.days - a.days || b.share - a.share),
      costliestId: pick((a, b) => b.share - a.share || b.days - a.days),
    },
    shared: {
      count: shared.length,
      paidByYouPercent: percentOf(paidByYou, shared.length),
      payers: payerList,
      householdIds: ranked(households),
      othersPaid: splits.reduce((sum, entry) => sum + entry.total - entry.share, 0),
    },
    facts: {
      daysWithoutSpending,
      longestRun: longestRun as YearReview["facts"]["longestRun"],
      expensesRecorded: expenses.length,
      perWeek: countedDays > 0 ? Math.round((expenses.length * 7) / countedDays) : 0,
      busiestWeekday,
      mostFrequentCategory: mostFrequent ? { key: mostFrequent.key, name: mostFrequent.name, icon: mostFrequent.icon, color: mostFrequent.color, count: mostFrequent.count } : null,
    },
  };
}

/**
 * The year the year in review is offered for (owner decision, 2026-11-26): from December 26 to
 * January 31. December 26–31 offers the year under way; January offers the year just over. Null
 * otherwise. The Insights card shows for the whole window.
 */
export function yearReviewYear(today: string): string | null {
  const year = Number(today.slice(0, 4));
  const month = today.slice(5, 7);
  if (month === "12" && Number(today.slice(8, 10)) >= 26) return String(year);
  if (month === "01") return String(year - 1);
  return null;
}

/** The year of the January banner ("Your 2026 in review is ready"): January only. Dismissing it is kept on the device. */
export function yearReviewBannerYear(today: string): string | null {
  return today.slice(5, 7) === "01" ? String(Number(today.slice(0, 4)) - 1) : null;
}

