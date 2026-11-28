import { validDate, type Ledger, type Transaction, type Trip } from "@domain/ledger.ts";
import { tripOverview, tripSummaries } from "@domain/selectors/trips.ts";
import type { Household, SharedExpense } from "../../api/schemas";
import { localDate, shortDate, shortRange } from "../households/model";
import { homeAmountsOf } from "../households/sharedCurrency";

/**
 * Trips (MAZ-93). A personal trip lives in the private ledger (offline first, `saveTrip`); a
 * shared trip is a household with a travel range on the server (online only). Sharing a personal
 * trip creates a shared trip and links the personal one to it with `sharedHouseholdId`, a private
 * ledger field nobody else sees. The rules here only decide what to show: the shared domain
 * (`saveTrip`, `saveEntry`) and the server still enforce every rule.
 */

export { tripOverview, tripSummaries };

export type TripPhase = "upcoming" | "now" | "past";

/** Where a trip is relative to today, on the user's own calendar. */
export function tripPhase(trip: { startDate: string; endDate: string }, today = localDate()): TripPhase {
  if (today < trip.startDate) return "upcoming";
  if (today > trip.endDate) return "past";
  return "now";
}

const DAY = 86_400_000;
const utc = (date: string) => {
  const [year = 2000, month = 1, day = 1] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
};

/** Whole calendar days from `today` to `date` (negative in the past). */
export const daysUntil = (date: string, today = localDate()) => Math.round((utc(date) - utc(today)) / DAY);

/** "In 3 days", "In 12 weeks" (`iphone-trip-personal`), "Tomorrow", "Now", "Upcoming" (over 26 weeks away) or "Past": always words, never color alone. */
export function phaseLabel(trip: { startDate: string; endDate: string }, today = localDate()): string {
  const phase = tripPhase(trip, today);
  if (phase === "now") return "Now";
  if (phase === "past") return "Past";
  const days = daysUntil(trip.startDate, today);
  if (days === 1) return "Tomorrow";
  if (days <= 30) return `In ${String(days)} days`;
  const weeks = Math.floor(days / 7);
  return weeks <= 26 ? `In ${String(weeks)} weeks` : "Upcoming";
}

/**
 * "Nov 12–19, 2026" or "Dec 28, 2026 – Jan 3, 2027" (cards `web-trips`, `ipad-trip`). With
 * `year: "auto"` the year is left out when the whole trip is in today's year, as on the iPhone
 * cards: "Nov 12–19", "Oct 3–5", but "Feb 14–21, 2027".
 */
export function tripRange(startDate: string, endDate: string, { year = "always", today = localDate() }: { year?: "always" | "auto"; today?: string } = {}): string {
  const startYear = startDate.slice(0, 4);
  const endYear = endDate.slice(0, 4);
  if (startYear !== endYear) return `${shortDate(startDate)}, ${startYear} – ${shortDate(endDate)}, ${endYear}`;
  const range = shortRange(startDate, endDate);
  return year === "auto" && startYear === today.slice(0, 4) ? range : `${range}, ${startYear}`;
}

/** "4 people" or "1 person". */
export const peopleCount = (count: number) => `${String(count)} ${count === 1 ? "person" : "people"}`;

/**
 * The words after a trip tile's dates (card `web-trips`): "upcoming" or "now" while it hasn't
 * ended, then "shared" for a shared trip; a past personal trip has none.
 */
export function tileStatus(card: Pick<TripCard, "kind" | "startDate" | "endDate">, today = localDate()): string | null {
  const phase = tripPhase(card, today);
  if (phase !== "past") return phase === "now" ? "now" : "upcoming";
  return card.kind === "shared" ? "shared" : null;
}

/**
 * The trip form's date note (card `iphone-trip-form`): "flights booked in October still count",
 * naming the month before the trip starts.
 */
export function outsideDatesNote(startDate: string): string {
  const [year = 2000, month = 1] = startDate.split("-").map(Number);
  const before = validDate(startDate) ? new Date(Date.UTC(year, month - 2, 1)).toLocaleDateString("en-CA", { month: "long", timeZone: "UTC" }) : null;
  return `Expenses can be dated outside the trip — flights booked ${before ? `in ${before}` : "before it"} still count.`;
}

/* ---------- the trip list ---------- */

export type SharedTrip = Household & { trip: { startDate: string; endDate: string } };

export const isSharedTrip = (household: Household): household is SharedTrip => Boolean(household.trip);

export type TripCard =
  | { kind: "personal"; id: string; name: string; startDate: string; endDate: string; trip: Trip; total: number; count: number; wasShared: boolean }
  | { kind: "shared"; id: string; name: string; startDate: string; endDate: string; household: SharedTrip; linked: Trip[] };

/**
 * Personal and shared trips as one list. A personal trip linked to a shared trip the account can
 * still see is folded into that shared trip (its expenses show there as "Only you"), so the trip
 * never appears twice and its money is never counted twice. A link to a shared trip that's gone
 * (archived, or never seen here) leaves the personal trip on its own, marked as once shared.
 */
export function tripCards(ledger: Pick<Ledger, "trips" | "transactions"> | null, households: readonly Household[] | undefined): TripCard[] {
  const shared = (households ?? []).filter(isSharedTrip);
  const sharedIds = new Set(shared.map((household) => household.id));
  const summaries = ledger ? tripSummaries(ledger.transactions) : new Map<string, { total: number; count: number }>();
  const personal: TripCard[] = (ledger?.trips ?? [])
    .filter((trip) => !trip.sharedHouseholdId || !sharedIds.has(trip.sharedHouseholdId))
    .map((trip) => ({
      kind: "personal",
      id: trip.id,
      name: trip.name,
      startDate: trip.startDate,
      endDate: trip.endDate,
      trip,
      total: summaries.get(trip.id)?.total ?? 0,
      count: summaries.get(trip.id)?.count ?? 0,
      // Without the household list (offline, the demo) a link can't be checked, so say nothing.
      wasShared: Boolean(trip.sharedHouseholdId) && households !== undefined,
    }));
  const together: TripCard[] = shared.map((household) => ({
    kind: "shared",
    id: household.id,
    name: household.name,
    startDate: household.trip.startDate,
    endDate: household.trip.endDate,
    household,
    linked: (ledger?.trips ?? []).filter((trip) => trip.sharedHouseholdId === household.id),
  }));
  return [...together, ...personal].sort((a, b) => b.startDate.localeCompare(a.startDate) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** The trip to feature at the top: one happening now, else the next one to start. */
export function featuredTrip(cards: readonly TripCard[], today = localDate()): TripCard | undefined {
  const now = cards.filter((card) => tripPhase(card, today) === "now");
  if (now.length) return [...now].sort((a, b) => a.endDate.localeCompare(b.endDate))[0];
  return [...cards].filter((card) => tripPhase(card, today) === "upcoming").sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
}

/* ---------- shared trip totals ---------- */

/** Personal expenses assigned to personal trips linked to this shared trip: private to the viewer. */
export function privateExpenses(ledger: Pick<Ledger, "trips" | "transactions"> | null, householdId: string): Transaction[] {
  if (!ledger) return [];
  const linked = new Set(ledger.trips.filter((trip) => trip.sharedHouseholdId === householdId).map((trip) => trip.id));
  return ledger.transactions
    .filter((entry) => entry.kind === "expense" && entry.tripId !== undefined && linked.has(entry.tripId))
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

/**
 * A shared trip's numbers. The trip total is what the group spent (shared expenses only); your
 * spending adds your shares of them to your private trip expenses. Each expense is counted once:
 * private entries are personal ledger rows, shared ones live on the server, and none is both.
 * `outside` counts expenses dated outside the travel range, which still belong to the trip.
 */
export function sharedTripTotals(expenses: readonly SharedExpense[], meId: string | undefined, personal: readonly Transaction[], range: { startDate: string; endDate: string }) {
  const tripTotal = expenses.reduce((sum, expense) => sum + expense.totalCents, 0);
  const sharedShare = meId ? expenses.reduce((sum, expense) => sum + (expense.splits.find((split) => split.userId === meId)?.amountCents ?? 0), 0) : 0;
  const privateShare = personal.reduce((sum, entry) => sum + entry.share, 0);
  const outside = [...expenses.map((expense) => expense.date), ...personal.map((entry) => entry.date)].filter((date) => date < range.startDate || date > range.endDate).length;
  return { tripTotal, sharedShare, privateShare, yourSpending: sharedShare + privateShare, outside };
}

/**
 * A shared trip's numbers in your home currency (MAZ-151 phase 2, `web-trip-currencies`,
 * `iphone-trip-currencies`): each shared expense at your home amounts (`home`, or its own amounts
 * when the trip is in your currency), plus your private trip expenses, which are already in it.
 * `missing` counts the expenses with no home amounts yet (no rate known), left out of both.
 */
export function homeTripTotals(
  expenses: readonly SharedExpense[],
  meId: string | undefined,
  personal: readonly Transaction[],
  range: { startDate: string; endDate: string },
  householdCurrency: string,
  home: string,
) {
  let tripTotal = 0;
  let sharedShare = 0;
  let missing = 0;
  for (const expense of expenses) {
    const shareCents = meId ? (expense.splits.find((split) => split.userId === meId)?.amountCents ?? 0) : 0;
    const amounts = homeAmountsOf({ ...expense, householdCurrency, shareCents }, home);
    if (!amounts) {
      missing += 1;
      continue;
    }
    tripTotal += amounts.total;
    sharedShare += amounts.share;
  }
  const privateShare = personal.reduce((sum, entry) => sum + entry.share, 0);
  const outside = [...expenses.map((expense) => expense.date), ...personal.map((entry) => entry.date)].filter((date) => date < range.startDate || date > range.endDate).length;
  return { tripTotal, sharedShare, privateShare, yourSpending: sharedShare + privateShare, outside, missing };
}

/** Personal trip expenses dated outside its travel range (they still count toward the trip). */
export const outsideRange = (entries: readonly Pick<Transaction, "date">[], trip: { startDate: string; endDate: string }) =>
  entries.filter((entry) => entry.date < trip.startDate || entry.date > trip.endDate).length;

/* ---------- the trip form ---------- */

export interface TripDraft {
  name: string;
  startDate: string;
  endDate: string;
}

export type TripField = keyof TripDraft;
export type TripErrors = Partial<Record<TripField, string>>;

/**
 * The trip rules a form can point at a field for, the same as the shared `saveTrip` and the
 * server's trip schema: a name of 1–80 characters, real dates from 2000 to 2100, the end on or
 * after the start. Duplicate names (personal only) are left to `saveTrip`, which knows the ledger.
 */
export function validateTrip(draft: TripDraft): TripErrors {
  const errors: TripErrors = {};
  const name = draft.name.trim();
  if (!name || name.length > 80) errors.name = "Give your trip a name of up to 80 characters.";
  const inRange = (date: string) => validDate(date) && date >= "2000-01-01" && date <= "2100-12-31";
  if (!inRange(draft.startDate)) errors.startDate = "Choose a real start date.";
  if (!inRange(draft.endDate)) errors.endDate = "Choose a real end date.";
  else if (!errors.startDate && draft.endDate < draft.startDate) errors.endDate = "The trip can't end before it starts.";
  return errors;
}

/**
 * The trips under the featured one on phones (card `iphone-trips`): UPCOMING (happening now or
 * still to come, soonest first) and PAST (most recent first).
 */
export function tripSections(cards: readonly TripCard[], today = localDate()) {
  const upcoming = cards.filter((card) => tripPhase(card, today) !== "past").sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name));
  const past = cards.filter((card) => tripPhase(card, today) === "past").sort((a, b) => b.endDate.localeCompare(a.endDate) || a.name.localeCompare(b.name));
  return { upcoming, past };
}

/**
 * The month a shared trip's balances open on: this month while the trip is on, else the trip's
 * first month before it starts and its last month after it ends (card `ipad-trip`: "November
 * balance" for a November trip, seen in early November). A `?month=` link still wins.
 */
export function tripMonth(range: { startDate: string; endDate: string }, today = localDate()): string {
  const month = today.slice(0, 7);
  const first = range.startDate.slice(0, 7);
  const last = range.endDate.slice(0, 7);
  return month < first ? first : month > last ? last : month;
}

export interface CategoryShare {
  key: string;
  /** The ledger category id, for private entries: a default category keeps its color (categoryTint). */
  id?: string;
  name: string;
  icon: string;
  color: string;
  amount: number;
}

/**
 * Your share of a shared trip by category (card `ipad-trip`), largest first: your split of each
 * shared expense under its shared category, plus your private trip expenses under their ledger
 * category. Categories are matched by name, so the same name from both sides is one row.
 */
export function shareByCategory(
  expenses: readonly SharedExpense[],
  meId: string | undefined,
  personal: readonly Transaction[],
  categories: readonly { id: string; name: string; icon: string; color: string }[],
): CategoryShare[] {
  const rows = new Map<string, CategoryShare>();
  const add = (category: { id?: string; name: string; icon: string; color: string }, amount: number) => {
    if (amount <= 0) return;
    const key = category.name.toLocaleLowerCase();
    const row = rows.get(key);
    if (row) row.amount += amount;
    else rows.set(key, { key, ...(category.id ? { id: category.id } : {}), name: category.name, icon: category.icon, color: category.color, amount });
  };
  for (const expense of expenses) add(expense.category, meId ? (expense.splits.find((split) => split.userId === meId)?.amountCents ?? 0) : 0);
  for (const entry of personal) {
    const category = categories.find((item) => item.id === entry.categoryId);
    add(category ?? { name: "Other", icon: "ellipsis-horizontal", color: "#8E8E93" }, entry.share);
  }
  return [...rows.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
}

/* ---------- shared trip expense rows ---------- */

/** How many people share an expense: the splits with an amount. */
export const splitCount = (expense: Pick<SharedExpense, "splits">) => expense.splits.filter((split) => split.amountCents > 0).length;

/**
 * Who paid, in the trip cards' words (`iphone-trip-detail`, `ipad-trip`): "you paid", or "Sam paid ·
 * split 4 ways" when someone else paid for more than one person.
 */
export function paidWords(expense: Pick<SharedExpense, "payerUserId" | "splits">, meId: string | undefined, name: string): string {
  if (meId !== undefined && expense.payerUserId === meId) return "you paid";
  const ways = splitCount(expense);
  return ways > 1 ? `${name} paid · split ${String(ways)} ways` : `${name} paid`;
}

/** The `web-trips` table's Paid by: "You", or "Sam · 4 ways" when someone else paid for more than one person. */
export function paidByCell(expense: Pick<SharedExpense, "payerUserId" | "splits">, meId: string | undefined, name: string): string {
  if (meId !== undefined && expense.payerUserId === meId) return "You";
  const ways = splitCount(expense);
  return ways > 1 ? `${name} · ${String(ways)} ways` : name;
}

/** "4 expenses" or "1 expense". */
export const expenseCount = (count: number) => `${String(count)} ${count === 1 ? "expense" : "expenses"}`;

/**
 * Whether a past shared trip is settled (card `web-trips`: the green Settled pill), from the recap
 * of the current month: no earlier month is left unsettled (`overdueMonths`), the current month
 * has nothing to pay back, and no trip expense is dated after it. A trip with no expenses has
 * nothing to settle, so it isn't called settled.
 */
export function tripSettled(expenses: readonly Pick<SharedExpense, "date">[], recap: { month: string; suggestions: readonly unknown[]; overdueMonths: readonly string[] }): boolean {
  if (!expenses.length) return false;
  if (recap.overdueMonths.length || recap.suggestions.length) return false;
  return expenses.every((expense) => expense.date.slice(0, 7) <= recap.month);
}
