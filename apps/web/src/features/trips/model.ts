import { validDate, type Ledger, type Transaction, type Trip } from "@domain/ledger.ts";
import { tripOverview, tripSummaries } from "@domain/selectors/trips.ts";
import type { Household, SharedExpense } from "../../api/schemas";
import { dayLabel, localDate } from "../households/model";

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

/** "In 3 days", "Tomorrow", "Now", "Upcoming" or "Past": always words, never color alone. */
export function phaseLabel(trip: { startDate: string; endDate: string }, today = localDate()): string {
  const phase = tripPhase(trip, today);
  if (phase === "now") return "Now";
  if (phase === "past") return "Past";
  const days = daysUntil(trip.startDate, today);
  if (days === 1) return "Tomorrow";
  return days <= 30 ? `In ${String(days)} days` : "Upcoming";
}

/** "Sat, Nov 12 – Thu, Nov 19, 2026": both ends, the year once (twice when the trip crosses a year). */
export function rangeLabel(startDate: string, endDate: string): string {
  if (startDate === endDate) return dayLabel(startDate, true);
  const sameYear = startDate.slice(0, 4) === endDate.slice(0, 4);
  return `${dayLabel(startDate, !sameYear)} – ${dayLabel(endDate, true)}`;
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
