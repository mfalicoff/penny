// MAZ-292 phase 2: the year in review (`yearReview`) and the window it's offered in. Kept beside
// generate-golden.ts, which writes it as contracts/fixtures/year-review.json. Inputs are curated
// here; each case's expectation is the whole `YearReview`, computed by the reference rule.
import type { Household, ProjectedExpense } from "../../src/domain/householdProjection.ts";
import { ledgerWithHouseholds } from "../../src/domain/householdProjection.ts";
import type { Ledger } from "../../src/domain/ledger.ts";
import { yearReview, yearReviewBannerYear, yearReviewYear } from "../../src/domain/yearReview.ts";

type Entry = Ledger["transactions"][number];

export function yearReviews(generator: string) {
  const categories: Ledger["categories"] = [
    { id: "home", name: "Home", icon: "home-outline", color: "#C6953A", kind: "expense" },
    { id: "groceries", name: "Groceries", icon: "basket-outline", color: "#2F9E6B", kind: "expense" },
    { id: "food", name: "Food & drinks", icon: "cafe-outline", color: "#E47850", kind: "expense" },
    { id: "transport", name: "Transport", icon: "bus-outline", color: "#3B82F6", kind: "expense" },
    { id: "shopping", name: "Shopping", icon: "bag-handle-outline", color: "#C8798D", kind: "expense" },
    { id: "fun", name: "Entertainment", icon: "musical-notes-outline", color: "#8E5BB1", kind: "expense" },
    { id: "salary", name: "Salary", icon: "cash-outline", color: "#3E8E5E", kind: "income" },
    { id: "savings", name: "Investments", icon: "trending-up-outline", color: "#5B7DB1", kind: "investment" },
  ];
  const entry = (id: string, kind: string, categoryId: string, share: number, date: string, extra: Partial<Entry> = {}): Entry =>
    ({ id, title: id, kind, total: share, share, categoryId, date, note: "", ...extra }) as Entry;
  const ledger = (transactions: Entry[], extra: Partial<Ledger> = {}): Ledger => ({
    version: 4, currency: "CAD", accounts: [{ id: "chq", name: "Chequing", type: "bank" }], trips: [], recurring: [], categories, transactions, ...extra,
  });

  // A year with rent every month, so the months and the categories have a clear order.
  const rent = Array.from({ length: 12 }, (_, index) => entry(`rent-${String(index + 1)}`, "expense", "home", 145000, `2026-${String(index + 1).padStart(2, "0")}-01`));
  const pay = Array.from({ length: 12 }, (_, index) => entry(`pay-${String(index + 1)}`, "income", "salary", 320000, `2026-${String(index + 1).padStart(2, "0")}-15`));
  const year = [
    ...rent,
    ...pay,
    entry("groceries-jan", "expense", "groceries", 21000, "2026-01-10"),
    entry("groceries-may", "expense", "groceries", 18500, "2026-05-09"),
    entry("groceries-dec", "expense", "groceries", 35620, "2026-12-05"),
    entry("coffee-mar", "expense", "food", 650, "2026-03-07"),
    entry("coffee-jun", "expense", "food", 700, "2026-06-13"),
    // Split with a friend: you paid $246.80 of $493.60.
    entry("dinner-dec", "expense", "food", 24680, "2026-12-12", { total: 49360 }),
    entry("bus-pass", "expense", "transport", 15600, "2026-09-02"),
    entry("boots", "expense", "shopping", 31840, "2026-12-19"),
    entry("tfsa", "investment", "savings", 50000, "2026-06-30"),
    // The ski week, a personal trip: only you.
    entry("ski-lodge", "expense", "fun", 86000, "2026-02-14", { tripId: "ski" }),
    // Your own spending on the Lisbon trip, on the personal trip linked to the shared one.
    entry("lisbon-flight", "expense", "transport", 64000, "2026-11-12", { tripId: "lisbon-personal" }),
    // Dated after today in the year-under-way case: an expense dated ahead still counts (MAZ-139).
    entry("concert-dec", "expense", "fun", 5350, "2026-12-30"),
    // Income dated after today is expected, not recorded, while the year is under way.
    entry("bonus", "income", "salary", 100000, "2026-12-31"),
  ];
  const trips: Ledger["trips"] = [
    { id: "ski", name: "Ski week", startDate: "2026-02-14", endDate: "2026-02-16" },
    { id: "lisbon-personal", name: "Lisbon", startDate: "2026-11-12", endDate: "2026-11-19", sharedHouseholdId: "lisbon" },
    // Linked to a shared trip you can't see anymore: counted on its own.
    { id: "cottage-personal", name: "Cottage weekend", startDate: "2026-08-22", endDate: "2026-08-24", sharedHouseholdId: "gone" },
    // Next year's trip: not in this year.
    { id: "spring", name: "Spring break", startDate: "2027-03-10", endDate: "2027-03-14" },
  ];
  const schedule = { ...entry("gym", "expense", "transport", 4000, "2026-01-28"), frequency: "monthly", nextDate: "2027-01-28", anchorDay: 28, active: true };
  const ledgers = {
    alex: ledger(year, { trips, recurring: [schedule] as Ledger["recurring"] }),
    // Recorded since September only: the days, months and trips before the first entry do not count.
    "first-year": ledger(year.filter((item) => item.date >= "2026-09-05"), { trips }),
    // Only a schedule in 2027: previews never count.
    "previews-only": ledger([], { recurring: [schedule] as Ledger["recurring"] }),
    empty: ledger([]),
  };

  const households: Pick<Household, "id" | "name" | "memberCount" | "trip">[] = [
    { id: "apartment", name: "Apartment", memberCount: 2 },
    { id: "lisbon", name: "Lisbon", memberCount: 4, trip: { startDate: "2026-11-12", endDate: "2026-11-19" } },
    // Overlaps the Lisbon trip by a day: each day away counts once.
    { id: "porto", name: "Porto", memberCount: 2, trip: { startDate: "2026-11-19", endDate: "2026-11-21" } },
  ];
  const jo = { email: "Jo@example.test", displayName: "Jo" };
  const mira = { email: "mira@example.test", displayName: "Mira" };
  const shared = (id: string, householdId: string, shareCents: number, totalCents: number, date: string, paidBy: "you" | typeof jo | { email: string; deleted: true } | null, extra: Partial<ProjectedExpense> = {}): ProjectedExpense => ({
    id, householdId, householdName: households.find((item) => item.id === householdId)?.name ?? householdId, householdCurrency: "CAD", title: id, date, totalCents, shareCents,
    category: { name: "groceries", icon: "basket-outline", color: "#0FA3A3" }, note: "", payerUserId: paidBy === "you" ? "me" : "other",
    ...(paidBy === "you" ? { payer: { email: "me@example.test", displayName: "Alex" }, paidByYou: true } : paidBy ? { payer: paidBy, paidByYou: false } : {}),
    ...extra,
  });
  const projections = {
    none: [],
    households: [
      shared("costco-mar", "apartment", 6140, 12280, "2026-03-14", jo),
      shared("costco-jul", "apartment", 5000, 10000, "2026-07-18", "you"),
      shared("hydro-oct", "apartment", 4000, 8000, "2026-10-20", "you", { category: { name: "Utilities", icon: "flash-outline", color: "#3B82F6" } }),
      shared("lisbon-hotel", "lisbon", 52000, 208000, "2026-11-13", jo, { category: { name: "Home", icon: "bed-outline", color: "#C6953A" } }),
      shared("lisbon-dinner", "lisbon", 8000, 32000, "2026-11-15", { ...mira }, { category: { name: "Food & drinks", icon: "restaurant-outline", color: "#E47850" } }),
      shared("lisbon-museum", "lisbon", 2000, 8000, "2026-11-16", "you", { category: { name: "Entertainment", icon: "ticket-outline", color: "#8E5BB1" } }),
      // A deleted payer: counted as "Former member", never by email.
      shared("pharmacy", "apartment", 1200, 2400, "2026-04-22", { email: "gone@example.test", deleted: true }),
      // An older row with no payer: counted in the total, not by who paid.
      shared("old-row", "apartment", 900, 1800, "2026-01-20", null),
      shared("porto-train", "porto", 3000, 6000, "2026-11-20", "you", { category: { name: "Transport", icon: "train-outline", color: "#3B82F6" } }),
      // Another currency than the ledger's: left out.
      shared("lisbon-taxi", "lisbon", 9000, 36000, "2026-11-14", jo, { householdCurrency: "EUR" }),
      // A shared preview: never counted.
      shared("internet", "apartment", 3000, 6000, "2026-12-29", "you", { scheduled: true, recurringId: "internet-rule" }),
      // Last year: not in this year.
      shared("costco-2025", "apartment", 5000, 10000, "2025-12-20", jo),
    ],
  };

  // The first year: shared expenses since September 5 only.
  const fromSeptember = projections.households.filter((row) => row.date >= "2026-09-05");
  const allProjections = { ...projections, "from-september": fromSeptember };
  const inputs: { name: string; ledger: keyof typeof ledgers; projection: keyof typeof allProjections; year: string; today: string }[] = [
    { name: "a whole year, with trips, shared expenses and who paid them", ledger: "alex", projection: "households", year: "2026", today: "2027-01-05" },
    { name: "the year under way: days count up to today, and later income is expected", ledger: "alex", projection: "households", year: "2026", today: "2026-12-27" },
    { name: "a year without shared expenses", ledger: "alex", projection: "none", year: "2026", today: "2027-01-05" },
    { name: "a first year: nothing before the first recorded entry counts", ledger: "first-year", projection: "from-september", year: "2026", today: "2027-01-05" },
    { name: "a year with only previews", ledger: "previews-only", projection: "none", year: "2027", today: "2027-01-10" },
    { name: "a year with no entries", ledger: "empty", projection: "none", year: "2026", today: "2027-01-05" },
  ];
  const cases = inputs.map((input) => ({
    ...input,
    expected: yearReview(ledgerWithHouseholds(ledgers[input.ledger], allProjections[input.projection]), input.year, { today: input.today, households }),
  }));
  const window = ["2026-12-25", "2026-12-26", "2026-12-31", "2027-01-01", "2027-01-31", "2027-02-01", "2026-06-15"].map((today) => ({
    today, year: yearReviewYear(today), banner: yearReviewBannerYear(today),
  }));
  return {
    generator,
    description: "The year in review (MAZ-292, `yearReview` in apps/web/src/domain/yearReview.ts), from the year's 12 months computed as the monthly recap's: recorded entries only, never scheduled previews; shared expenses at your share through the household projection, shared rows in another currency left out. Days count from January 1, or from the first recorded entry in a first year, up to today. Percentages are whole numbers rounded half away from zero. Categories match by name. Trips are shared trips (households with a travel range) and personal trips not linked to a shared trip you can see, with their days in the year and your share; days away count each day once. Shared expenses are counted by who paid (a row with no payer only in the total); a deleted payer keeps `deleted` and shows as \"Former member\". Weekdays are ISO (1 Monday). The year in review is offered from December 26 (the year under way) to January 31 (the year just over); the banner shows in January.",
    households, ledgers, projections: allProjections, cases, window,
  };
}
