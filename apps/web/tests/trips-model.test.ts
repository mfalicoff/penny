import { saveEntry, saveTrip } from "@domain/commands.ts";
import { upgradeLedger, type Ledger, type Transaction, type Trip } from "@domain/ledger.ts";
import { describe, expect, it } from "vitest";
import type { Household, SharedExpense } from "../src/api/schemas";
import {
  daysUntil,
  featuredTrip,
  outsideRange,
  phaseLabel,
  privateExpenses,
  rangeLabel,
  sharedTripTotals,
  tripCards,
  tripPhase,
  validateTrip,
} from "../src/features/trips/model";

// Synthetic trips and amounts only.

const trip = (id: string, name: string, startDate: string, endDate: string, extra: Partial<Trip> = {}): Trip => ({ id, name, startDate, endDate, ...extra });
const expense = (id: string, date: string, share: number, extra: Partial<Transaction> = {}): Transaction => ({
  id,
  title: `Expense ${id}`,
  kind: "expense",
  total: share,
  share,
  categoryId: "food",
  date,
  note: "",
  ...extra,
});

function ledger(trips: Trip[], transactions: Transaction[]): Ledger {
  return upgradeLedger({
    version: 4,
    currency: "CAD",
    accounts: [],
    trips,
    categories: [{ id: "food", name: "Food", icon: "cafe-outline", color: "#E47850", kind: "expense" }],
    transactions,
    recurring: [],
  } as unknown as Ledger);
}

const household = (id: string, name: string, trip?: { startDate: string; endDate: string }): Household => ({
  id,
  name,
  currency: "CAD",
  creatorId: "u1",
  createdAt: 0,
  memberCount: 2,
  ...(trip ? { trip } : {}),
});

const shared = (id: string, date: string, total: number, splits: [string, number][]): SharedExpense =>
  ({
    id,
    householdId: "h1",
    title: id,
    totalCents: total,
    date,
    payerUserId: "u1",
    splitMode: "equal",
    splits: splits.map(([userId, amountCents]) => ({ userId, amountCents })),
    payments: [],
    category: { name: "Food", icon: "cafe", color: "#E47850" },
    note: "",
    revision: 1,
  }) as unknown as SharedExpense;

describe("dates and phases", () => {
  it("places a trip before, during and after on the local calendar", () => {
    const lisbon = { startDate: "2026-11-12", endDate: "2026-11-19" };
    expect(tripPhase(lisbon, "2026-11-11")).toBe("upcoming");
    expect(tripPhase(lisbon, "2026-11-12")).toBe("now");
    expect(tripPhase(lisbon, "2026-11-19")).toBe("now");
    expect(tripPhase(lisbon, "2026-11-20")).toBe("past");
    expect(phaseLabel(lisbon, "2026-11-11")).toBe("Tomorrow");
    expect(phaseLabel(lisbon, "2026-11-09")).toBe("In 3 days");
    expect(phaseLabel(lisbon, "2026-09-01")).toBe("Upcoming");
    expect(phaseLabel(lisbon, "2026-11-15")).toBe("Now");
    expect(phaseLabel(lisbon, "2027-01-01")).toBe("Past");
  });

  it("counts days across a daylight-saving change and a leap day", () => {
    expect(daysUntil("2026-11-02", "2026-10-31")).toBe(2);
    expect(daysUntil("2028-03-01", "2028-02-28")).toBe(2);
    expect(daysUntil("2026-01-01", "2026-01-02")).toBe(-1);
  });

  it("writes both ends of the range, with the year once unless the trip crosses one", () => {
    expect(rangeLabel("2026-11-12", "2026-11-19")).toBe("Thu, Nov 12 – Thu, Nov 19, 2026");
    expect(rangeLabel("2026-12-28", "2027-01-03")).toBe("Mon, Dec 28, 2026 – Sun, Jan 3, 2027");
    expect(rangeLabel("2026-11-12", "2026-11-12")).toBe("Thu, Nov 12, 2026");
  });
});

describe("the trip list", () => {
  it("folds a personal trip linked to a shared trip into it, so nothing is listed or counted twice", () => {
    const book = ledger(
      [trip("p1", "Lisbon (mine)", "2026-11-12", "2026-11-19", { sharedHouseholdId: "h1" }), trip("p2", "Ski week", "2027-02-14", "2027-02-21")],
      [expense("e1", "2026-09-28", 2400, { tripId: "p1" }), expense("e2", "2027-01-10", 64000, { tripId: "p2" })],
    );
    const cards = tripCards(book, [household("h1", "Lisbon", { startDate: "2026-11-12", endDate: "2026-11-19" }), household("h2", "Maison")]);
    expect(cards.map((card) => `${card.kind}:${card.name}`)).toEqual(["personal:Ski week", "shared:Lisbon"]);
    const lisbon = cards.find((card) => card.kind === "shared");
    expect(lisbon?.kind === "shared" ? lisbon.linked.map((item) => item.id) : []).toEqual(["p1"]);
    const ski = cards.find((card) => card.kind === "personal");
    expect(ski?.kind === "personal" ? [ski.total, ski.count, ski.wasShared] : []).toEqual([64000, 1, false]);
  });

  it("keeps a personal trip whose shared trip is gone, marked as once shared", () => {
    const book = ledger([trip("p1", "Coast", "2026-08-22", "2026-08-24", { sharedHouseholdId: "archived" })], []);
    const [card] = tripCards(book, []);
    expect(card?.kind === "personal" && card.wasShared).toBe(true);
    // Without the household list (offline, the demo) the link can't be checked, so nothing is claimed.
    const [unknown] = tripCards(book, undefined);
    expect(unknown?.kind === "personal" && unknown.wasShared).toBe(false);
  });

  it("features the trip happening now, else the next one, never a past one", () => {
    const cards = tripCards(ledger([trip("a", "Past", "2026-01-01", "2026-01-05"), trip("b", "Later", "2027-02-01", "2027-02-05"), trip("c", "Soon", "2026-12-01", "2026-12-05")], []), []);
    expect(featuredTrip(cards, "2026-11-11")?.name).toBe("Soon");
    expect(featuredTrip(cards, "2026-12-03")?.name).toBe("Soon");
    expect(featuredTrip(cards, "2027-03-01")).toBeUndefined();
  });
});

describe("shared trip totals", () => {
  it("adds your shared shares and private expenses once, and leaves private ones out of the trip total", () => {
    const book = ledger(
      [trip("p1", "Lisbon", "2026-11-12", "2026-11-19", { sharedHouseholdId: "h1" }), trip("p2", "Other", "2026-11-01", "2026-11-02")],
      [expense("e1", "2026-09-28", 2400, { tripId: "p1" }), expense("e2", "2026-11-13", 1000, { tripId: "p2" }), expense("e3", "2026-11-13", 999)],
    );
    const mine = privateExpenses(book, "h1");
    expect(mine.map((entry) => entry.id)).toEqual(["e1"]);
    const totals = sharedTripTotals(
      [shared("flights", "2026-10-02", 82400, [["u1", 20600], ["u2", 61800]]), shared("dinner", "2026-11-14", 6000, [["u2", 6000]])],
      "u1",
      mine,
      { startDate: "2026-11-12", endDate: "2026-11-19" },
    );
    expect(totals).toEqual({ tripTotal: 88400, sharedShare: 20600, privateShare: 2400, yourSpending: 23000, outside: 2 });
  });

  it("counts personal trip expenses dated outside the travel range", () => {
    expect(outsideRange([{ date: "2026-10-01" }, { date: "2026-11-12" }, { date: "2026-11-20" }], { startDate: "2026-11-12", endDate: "2026-11-19" })).toBe(2);
  });
});

describe("trip rules", () => {
  it("checks names and dates like the shared command and the server", () => {
    expect(validateTrip({ name: " ", startDate: "2026-11-12", endDate: "2026-11-19" })).toEqual({ name: "Give your trip a name of up to 80 characters." });
    expect(validateTrip({ name: "x".repeat(81), startDate: "2026-11-12", endDate: "2026-11-19" }).name).toBeDefined();
    expect(validateTrip({ name: "Lisbon", startDate: "2026-02-30", endDate: "2026-03-01" })).toEqual({ startDate: "Choose a real start date." });
    expect(validateTrip({ name: "Lisbon", startDate: "2026-11-19", endDate: "2026-11-12" })).toEqual({ endDate: "The trip can't end before it starts." });
    expect(validateTrip({ name: "Lisbon", startDate: "2101-01-01", endDate: "2101-01-02" }).startDate).toBeDefined();
    expect(validateTrip({ name: "Lisbon", startDate: "2028-02-29", endDate: "2028-02-29" })).toEqual({});
  });

  it("refuses deleting a trip with expenses and assigning to a removed trip (shared saveTrip and saveEntry)", () => {
    const lisbon = trip("p1", "Lisbon", "2026-11-12", "2026-11-19");
    const book = ledger([lisbon], [expense("e1", "2026-11-13", 1000, { tripId: "p1" })]);
    expect(() => saveTrip(lisbon, lisbon, true)(book)).toThrow("This trip has expenses. Reassign them before deleting it.");
    const empty = ledger([lisbon], []);
    expect(saveTrip(lisbon, lisbon, true)(empty).trips).toEqual([]);
    expect(() => saveEntry(expense("e2", "2026-11-13", 1000, { tripId: "gone" }))(empty)).toThrow("This trip is no longer available. Choose another trip.");
    expect(() => saveEntry(expense("e3", "2026-11-13", 1000, { tripId: "p1", kind: "income", categoryId: "food" }))(empty)).toThrow(/trip is no longer available/);
  });

  it("links a personal trip to a shared trip without touching its expenses, and refuses a stale link", () => {
    const lisbon = trip("p1", "Lisbon", "2026-11-12", "2026-11-19");
    const book = ledger([lisbon], [expense("e1", "2026-09-28", 2400, { tripId: "p1" })]);
    const linked = saveTrip({ ...lisbon, sharedHouseholdId: "h1" }, lisbon)(book);
    expect(linked.trips[0]?.sharedHouseholdId).toBe("h1");
    expect(linked.transactions).toEqual(book.transactions);
    const renamed = saveTrip({ ...lisbon, name: "Lisboa" }, lisbon)(book);
    expect(() => saveTrip({ ...lisbon, sharedHouseholdId: "h1" }, lisbon)(renamed)).toThrow("This trip changed on another device. Reopen it before editing.");
  });
});
