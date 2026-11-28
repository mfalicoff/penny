// Generates the language-neutral golden fixtures from the reference TypeScript rules (the
// observable contract) and the fixture manifest (MAZ-62). Inputs are curated here;
// expectations are computed, so the files never drift from the reference behavior.
//
//   node --experimental-strip-types apps/web/scripts/fixtures/generate-golden.ts          # write
//   node --experimental-strip-types apps/web/scripts/fixtures/generate-golden.ts --check  # verify
//
// Output is byte-for-byte deterministic: no clock, randomness or locale is read, and the
// date rules run at local noon, so any TZ produces the same files (tests check this).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { cents, nextOccurrence, personalShare, type Frequency, type Ledger } from "../../src/domain/ledger.ts";
import { mergeLedger } from "../../src/domain/merge.ts";
import { dateKeyIn } from "../../src/domain/calendar.ts";
import { monthBreakdown, summarizeMonth } from "../../src/domain/summary.ts";
import { ledgerWithHouseholds, type ProjectedExpense } from "../../src/domain/householdProjection.ts";
import { memberAmounts, settleIn, sharedExpenseCurrencyProblem } from "../../src/domain/households.ts";
import { monthReview, reviewBannerMonth } from "../../src/domain/monthReview.ts";
import { recurringSuggestions, suggestionKey } from "../../src/domain/suggestions.ts";
import { yearReviews } from "./year-review.ts";
import { ledgerWriteSchema } from "../../src/validation/ledger.ts";
import {
  convertAmount, crossRate, currencies, entryAmounts, homeCurrencies, normalizeRate, parseAmount, publishedRateDate, reconvertEntry,
  type SplitMode,
} from "../../src/domain/currency.ts";

const directory = new URL("../../../../contracts/fixtures/", import.meta.url);
const generator = "apps/web/scripts/fixtures/generate-golden.ts";

type Outcome<T> = { value: T } | { error: string };
function attempt<T>(run: () => T): Outcome<T> {
  try {
    return { value: run() };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

function money() {
  const inputs = [
    "0", "0.01", "0.1", "1", "1.5", "1,50", " 12.30 ", "12.", "007.25", "999999999.99", "999999999",
    "1000000000", "1.234", "-1", "", "  ", "abc", ".5", "1e3", "1 000", "+3", "١٢",
  ];
  const parse = inputs.map((input) => {
    const result = attempt(() => cents(input));
    return "value" in result ? { input, cents: result.value } : { input, error: result.error };
  });
  const shareInputs: [number, "full" | "equal" | "amount" | "percent", string][] = [
    [1001, "full", ""], [1001, "equal", "2"], [1001, "equal", "3"], [1, "equal", "2"], [1001, "equal", "1"],
    [1001, "equal", "101"], [1001, "equal", "2.5"], [1001, "percent", "33.33"], [1001, "percent", "50"],
    [1001, "percent", "100"], [1001, "percent", "100.01"], [1001, "percent", "0"], [1001, "amount", "10.01"],
    [1001, "amount", "10.02"], [1001, "amount", "0"], [99999999999, "equal", "3"], [99999999999, "percent", "33.33"],
  ];
  const personalShares = shareInputs.map(([total, mode, input]) => {
    const result = attempt(() => personalShare(total, mode, input));
    return "value" in result ? { total, mode, input, share: result.value } : { total, mode, input, error: result.error };
  });
  // Integer-cent bounds of a stored entry, as the ledger write schema enforces them.
  const entry = (total: unknown, share: unknown) => ({
    version: 4, currency: "CAD", accounts: [], trips: [], recurring: [],
    categories: [{ id: "food", name: "Food", icon: "cafe-outline", color: "#E47850", kind: "expense" }],
    transactions: [{ id: "t", title: "Sample", kind: "expense", total, share, categoryId: "food", date: "2026-10-01", note: "" }],
  });
  const bounds: [unknown, unknown][] = [
    [1, 0], [1, 1], [0, 0], [99999999999, 99999999999], [100000000000, 0], [500, 501], [1.5, 1], [-1, 0], [500, -1],
  ];
  const ledgerAmounts = bounds.map(([total, share]) => ({
    total, share, valid: ledgerWriteSchema.safeParse({ revision: 0, ledger: entry(total, share) }).success,
  }));
  // Contract 2.2.0: the optional participant count of a split expense, on entries and rules.
  // `participants: null` stands for an absent field (null itself is never valid JSON input).
  const participantCases: [string, "transaction" | "recurring", number | null][] = [
    ["expense", "transaction", null], ["expense", "transaction", 2], ["expense", "transaction", 100],
    ["expense", "transaction", 1], ["expense", "transaction", 0], ["expense", "transaction", 101],
    ["expense", "transaction", 2.5], ["income", "transaction", 2],
    ["investment", "transaction", 3], ["expense", "recurring", 3], ["expense", "recurring", 1], ["income", "recurring", 2],
  ];
  const ledgerParticipants = participantCases.map(([kind, list, participants]) => {
    const categories = [{ id: "c", name: "Category", icon: "cafe-outline", color: "#E47850", kind }];
    const item = {
      id: "t", title: "Sample", kind, total: 1000, share: kind === "expense" ? 500 : 1000,
      ...(participants === null ? {} : { participants }), categoryId: "c", date: "2026-10-01", note: "",
    };
    const ledger = {
      version: 4, currency: "CAD", accounts: [], trips: [], categories,
      transactions: list === "transaction" ? [item] : [],
      recurring: list === "recurring" ? [{ ...item, frequency: "monthly", nextDate: "2026-11-01", anchorDay: 1, active: true }] : [],
    };
    return { kind, list, participants, valid: ledgerWriteSchema.safeParse({ revision: 0, ledger }).success };
  });
  return { generator, description: "Integer-cent money: client amount parsing (cents), personal share entry, the stored entry total/share bounds every server enforces, and the optional participant count of a split expense (contract 2.2.0: an integer from 2 to 100, on expenses only; `participants: null` means the field is absent).", parse, personalShares, ledgerAmounts, ledgerParticipants };
}

function recurrence() {
  const starts: [string, Frequency, number][] = [
    ["2025-01-31", "monthly", 31], ["2025-02-28", "monthly", 31], ["2024-01-31", "monthly", 31], ["2024-02-29", "monthly", 29],
    ["2026-01-30", "monthly", 30], ["2026-03-31", "monthly", 31], ["2026-04-30", "monthly", 31], ["2026-12-31", "monthly", 31],
    ["2026-01-15", "monthly", 15], ["2024-02-29", "yearly", 29], ["2025-02-28", "yearly", 29], ["2026-10-31", "yearly", 31],
    ["2026-12-29", "weekly", 29], ["2024-02-26", "weekly", 26], ["2026-03-06", "weekly", 6], ["2026-10-30", "weekly", 30],
  ];
  const next = starts.map(([date, frequency, anchorDay]) => ({ date, frequency, anchorDay, next: nextOccurrence(date, frequency, anchorDay) }));
  // Following the anchor (not the clamped date) over many steps never drifts.
  const sequences = ([["2026-01-31", "monthly", 31], ["2024-02-29", "yearly", 29], ["2026-08-30", "monthly", 30], ["2026-12-28", "weekly", 28]] as [string, Frequency, number][])
    .map(([start, frequency, anchorDay]) => {
      const dates = [start];
      while (dates.length < 13) dates.push(nextOccurrence(dates.at(-1)!, frequency, anchorDay));
      return { start, frequency, anchorDay, dates };
    });
  return { generator, description: "Recurrence: next occurrence by frequency and anchor day (short months, leap years, year ends, DST weeks) and 12-step sequences that keep the anchor.", next, sequences };
}

function ledger(transactions: object[], extra: Partial<Ledger> = {}): Ledger {
  return {
    version: 4, currency: "CAD", accounts: [{ id: "chq", name: "Chequing", type: "bank" }], trips: [], recurring: [],
    categories: [{ id: "food", name: "Food", icon: "cafe-outline", color: "#E47850", kind: "expense" }],
    transactions: transactions as Ledger["transactions"], ...extra,
  };
}

// Personal recurrence after an offline catch-up (docs/ios/offline-sync.md): the base was synced
// with the pass due Nov 1; this device then recorded Nov 1 and moved the rule to Dec 1 offline.
function recurringMergeCases() {
  const pass = { id: "pass", title: "Transit pass", kind: "expense", total: 15600, share: 15600, categoryId: "food", accountId: "chq", date: "2026-10-01", note: "", frequency: "monthly", nextDate: "2026-11-01", anchorDay: 1, active: true } as const;
  const nov = { id: "pass:2026-11-01", title: "Transit pass", kind: "expense", total: 15600, share: 15600, categoryId: "food", accountId: "chq", date: "2026-11-01", note: "", recurringId: "pass" } as const;
  const dec = { ...nov, id: "pass:2026-12-01", date: "2026-12-01" };
  const base = ledger([], { recurring: [pass] });
  const caughtUp = ledger([nov], { recurring: [{ ...pass, nextDate: "2026-12-01" }] });
  return [
    { name: "recurring: a rule deleted remotely stays deleted after a local catch-up, with its untouched occurrence", base, local: caughtUp, remote: ledger([]) },
    { name: "recurring: a rule deleted remotely comes back when edited locally", base, local: ledger([nov], { recurring: [{ ...pass, nextDate: "2026-12-01", total: 16000, share: 16000 }] }), remote: ledger([]) },
    { name: "recurring: the later nextDate wins when both sides caught up", base, local: caughtUp, remote: ledger([nov, dec], { recurring: [{ ...pass, nextDate: "2027-01-01" }] }) },
    { name: "recurring: an occurrence both sides recorded keeps the server's edit", base, local: caughtUp, remote: ledger([{ ...nov, note: "Edited elsewhere" }], { recurring: [{ ...pass, nextDate: "2026-12-01" }] }) },
    { name: "recurring: an untouched occurrence the server recorded and deleted is dropped", base, local: caughtUp, remote: ledger([], { recurring: [{ ...pass, nextDate: "2026-12-01" }] }) },
  ];
}

// MAZ-151: an entry in another currency merges its amounts as one group.
function currencyMergeCases() {
  const cafe = {
    id: "cafe", title: "Cooking class", kind: "expense", total: 12420, share: 12420, categoryId: "food", date: "2026-11-03", note: "",
    originalAmount: 8500, originalCurrency: "EUR", rate: "1.4612", rateStatus: "published", rateDate: "2026-11-03",
  } as const;
  const museum = {
    id: "museum", title: "Museum passes", kind: "expense", total: 7022, share: 7022, categoryId: "food", date: "2026-11-09", note: "",
    originalAmount: 4800, originalCurrency: "EUR", rate: "1.463", rateStatus: "provisional", rateDate: "2026-11-06",
  } as const;
  const { rateDate: _published, ...edited } = { ...cafe, rate: "1.49", rateStatus: "edited", total: 12665, share: 12665 } as const;
  const base = ledger([cafe, museum]);
  return [
    {
      name: "currency: a local rate edit keeps its whole amount group over a remote amount change",
      base, local: ledger([edited, museum]), remote: ledger([{ ...cafe, originalAmount: 9000, total: 13151, share: 13151, note: "Remote" }, museum]),
    },
    {
      name: "currency: a provisional rate made final remotely survives a local note edit",
      base, local: ledger([cafe, { ...museum, note: "Local" }]),
      remote: ledger([cafe, { ...museum, rate: "1.4655", rateStatus: "published", rateDate: "2026-11-09", total: 7034, share: 7034 }]),
    },
  ];
}

function merge() {
  const lunch = { id: "lunch", title: "Lunch", kind: "expense", total: 1200, share: 1200, categoryId: "food", date: "2026-10-01", note: "" };
  const taxi = { id: "taxi", title: "Taxi", kind: "expense", total: 2000, share: 2000, categoryId: "food", date: "2026-10-02", note: "" };
  const base = ledger([lunch, taxi]);
  const cases: { name: string; base: Ledger; local: Ledger; remote: Ledger }[] = [
    { name: "independent fields both survive", base, local: ledger([{ ...lunch, note: "Local note" }, taxi]), remote: ledger([{ ...lunch, total: 1500, share: 1500 }, taxi]) },
    { name: "same field: the local edit wins", base, local: ledger([{ ...lunch, title: "Local lunch" }, taxi]), remote: ledger([{ ...lunch, title: "Remote lunch" }, taxi]) },
    { name: "local delete removes a remotely edited entry", base, local: ledger([taxi]), remote: ledger([{ ...lunch, note: "Remote" }, taxi]) },
    { name: "local edit restores an entry deleted remotely", base, local: ledger([{ ...lunch, note: "Kept" }, taxi]), remote: ledger([taxi]) },
    { name: "unchanged local entry follows a remote delete", base, local: base, remote: ledger([taxi]) },
    { name: "local create is appended after remote entries", base, local: ledger([lunch, taxi, { ...taxi, id: "new", title: "New" }]), remote: ledger([lunch, taxi, { ...taxi, id: "remote-new", title: "Remote new" }]) },
    { name: "local field removal (unlink account) survives a remote note", base: ledger([{ ...lunch, accountId: "chq" }, taxi]), local: ledger([lunch, taxi]), remote: ledger([{ ...lunch, accountId: "chq", note: "Remote" }, taxi]) },
    { name: "currency: local change wins, otherwise remote", base, local: ledger([lunch, taxi], { currency: "USD" }), remote: ledger([lunch, taxi], { currency: "EUR" }) },
    { name: "remote currency change kept when local unchanged", base, local: base, remote: ledger([lunch, taxi], { currency: "EUR" }) },
    { name: "category rename merges with an entry edit", base, local: ledger([lunch, { ...taxi, note: "Airport" }]), remote: ledger([lunch, taxi], { categories: [{ id: "food", name: "Groceries & dining", icon: "cafe-outline", color: "#E47850", kind: "expense" }] }) },
    ...recurringMergeCases(),
    ...dismissalMergeCases(),
    ...currencyMergeCases(),
  ];
  return {
    generator,
    description: "Three-way ledger merge (offline sync after a 409): base is the last synced server ledger, local the unsynced device ledger, remote the newer server ledger.",
    cases: cases.map((item) => ({ ...item, expected: JSON.parse(JSON.stringify(mergeLedger(item.base, item.local, item.remote))) })),
  };
}

// MAZ-151: entries in several currencies. The currency list with its minor units, amount and rate
// parsing, conversion and rounding, cross rates, which publication a date uses, the stored amounts
// of a typed entry, re-conversion when a rate changes, and the ledger write rules.
function currency() {
  const parse = ([
    ["85.00", "EUR"], ["85", "EUR"], ["85,5", "EUR"], ["1200", "JPY"], ["1200.5", "JPY"], ["1.234", "KWD"], ["1.2345", "KWD"],
    ["0.5", "BHD"], ["99999999999", "JPY"], ["999999999.99", "EUR"], ["99999999.999", "KWD"], ["1000000000", "EUR"], ["", "EUR"],
    ["-1", "EUR"], ["1", "XXX"],
  ] as const).map(([input, code]) => {
    const result = attempt(() => parseAmount(input, code));
    return "value" in result ? { input, currency: code, amount: result.value } : { input, currency: code, error: result.error };
  });
  const rates = ["1.4612", "1,4900", "1.4900", " 0.0093 ", "0010.50", "1", "0", "0.00000000", "0.00000001", "1.123456789", "1234567890", "-1", "1e3", ""]
    .map((input) => {
      const result = attempt(() => normalizeRate(input));
      return "value" in result ? { input, rate: result.value } : { input, error: result.error };
    });
  const conversions = ([
    [8500, "EUR", "1.4612", "CAD"], [8500, "EUR", "1.49", "CAD"], [4800, "EUR", "1.463", "CAD"], [3499, "USD", "1.373", "CAD"],
    [1200, "JPY", "0.00906283", "CAD"], [1, "JPY", "0.0093", "CAD"], [1234, "KWD", "4.48", "CAD"], [5, "EUR", "0.1", "CAD"],
    [15, "EUR", "0.1", "CAD"], [25, "EUR", "0.1", "CAD"], [10000, "CAD", "109.5", "JPY"], [10000, "CAD", "0.2215", "KWD"],
    [99999999999, "JPY", "0.00000001", "CAD"], [0, "EUR", "1.4612", "CAD"],
  ] as const).map(([amount, from, rate, home]) => ({ amount, from, rate, home, converted: convertAmount(amount, from, rate, home) }));
  // ECB quotes per euro; the euro itself is "1".
  const crossRates = ([
    ["1", "1.4612"], ["1.0812", "1.4612"], ["161.23", "1.4612"], ["1.4612", "1"], ["1.4612", "1.4612"], ["17000", "0.84"],
    ["0.84", "17000"], ["1", "0.00000001"], ["99999999", "0.00000001"], ["3", "1"], ["7", "2"],
  ] as const).map(([fromPerBase, toPerBase]) => ({ fromPerBase, toPerBase, rate: crossRate(fromPerBase, toPerBase) }));
  const published = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
  const rateDates = ["2026-11-03", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-01", "2026-11-06"].map((date) => ({
    published, date, expected: publishedRateDate(published, date),
  }));
  rateDates.push({ published: [], date: "2026-11-03", expected: publishedRateDate([], "2026-11-03") });
  const entryCases = ([
    ["85.00", "EUR", "CAD", "1.4612", "full", ""], ["85.00", "EUR", "CAD", "1.4612", "equal", "2"], ["373.25", "CAD", "CAD", undefined, "equal", "4"],
    ["85.00", "EUR", "CAD", "1.4612", "percent", "25"], ["85.00", "EUR", "CAD", "1.4612", "amount", "40"], ["85.00", "EUR", "CAD", "1.4612", "amount", "85.01"],
    ["1200", "JPY", "CAD", "0.00906283", "equal", "3"], ["1200.5", "JPY", "CAD", "0.00906283", "full", ""], ["85.00", "EUR", "CAD", undefined, "full", ""],
    ["0.01", "JPY", "CAD", "0.0093", "full", ""], ["1", "JPY", "CAD", "0.0001", "full", ""], ["12.345", "KWD", "CAD", "4.48", "full", ""],
  ] as const).map(([amount, code, home, rate, mode, split]) => {
    const result = attempt(() => entryAmounts({ amount, currency: code, home, rate, mode: mode as SplitMode, split }));
    const input = { amount, currency: code, home, ...(rate === undefined ? {} : { rate }), mode, split };
    return "value" in result ? { ...input, expected: result.value } : { ...input, error: result.error };
  });
  const foreign = { kind: "expense" as const, originalAmount: 4800, originalCurrency: "EUR", rate: "1.463", rateStatus: "provisional" as const, rateDate: "2026-11-06" };
  const final = { rate: "1.4655", rateStatus: "published" as const, rateDate: "2026-11-09" };
  const reconversions = [
    { entry: { ...foreign, total: 7022, share: 7022 }, next: final },
    { entry: { ...foreign, total: 7022, share: 3511, participants: 2 }, next: final },
    { entry: { ...foreign, originalAmount: 1001, rate: "1", total: 1001, share: 334, participants: 3 }, next: { rate: "1.5", rateStatus: "published" as const, rateDate: "2026-11-09" } },
    { entry: { ...foreign, total: 7022, share: 2000 }, next: final },
    { entry: { ...foreign, total: 7022, share: 7022 }, next: { rate: "1.5", rateStatus: "edited" as const } },
    { entry: { ...foreign, rateStatus: "edited" as const, rateDate: undefined, total: 7022, share: 7022 }, next: final },
    { entry: { kind: "expense" as const, total: 7022, share: 7022 }, next: final },
  ].map(({ entry, next }) => {
    const clean = JSON.parse(JSON.stringify(entry));
    return { home: "CAD", entry: clean, next, expected: JSON.parse(JSON.stringify(reconvertEntry(clean, "CAD", next))) };
  });
  const base = { id: "t", title: "Cooking class", kind: "expense", total: 12420, share: 12420, categoryId: "food", date: "2026-11-03", note: "" };
  const eur = { originalAmount: 8500, originalCurrency: "EUR", rate: "1.4612", rateStatus: "published", rateDate: "2026-11-03" };
  const rule = { frequency: "monthly", nextDate: "2026-12-03", anchorDay: 3, active: true };
  const ledgerCase = (name: string, entry: object, list: "transaction" | "recurring" = "transaction", home = "CAD") => {
    const value = {
      version: 4, currency: home, accounts: [], trips: [], categories: [{ id: "food", name: "Food", icon: "cafe-outline", color: "#E47850", kind: "expense" }],
      transactions: list === "transaction" ? [entry] : [], recurring: list === "recurring" ? [{ ...entry, ...rule }] : [],
    };
    const result = ledgerWriteSchema.safeParse({ revision: 0, ledger: value });
    return { name, ledger: value, valid: result.success };
  };
  const { rateDate: _date, ...noDate } = eur;
  const ledgers: { name: string; ledger: object; valid: boolean }[] = [
    ledgerCase("home entry", { ...base }),
    ledgerCase("euro entry at the published rate", { ...base, ...eur }),
    ledgerCase("provisional rate", { ...base, ...eur, rateStatus: "provisional", rateDate: "2026-11-02" }),
    ledgerCase("edited rate has no publication date", { ...base, ...noDate, rateStatus: "edited", rate: "1.49", total: 12665, share: 12665 }),
    ledgerCase("edited rate with a publication date", { ...base, ...eur, rateStatus: "edited" }),
    ledgerCase("published rate without its date", { ...base, ...noDate }),
    ledgerCase("total that doesn't match the conversion", { ...base, ...eur, total: 12421, share: 12421 }),
    ledgerCase("share above the converted total", { ...base, ...eur, share: 12421 }),
    ledgerCase("original amount without a rate", { ...base, originalAmount: 8500, originalCurrency: "EUR" }),
    ledgerCase("rate date alone", { ...base, rateDate: "2026-11-03" }),
    ledgerCase("original currency is the home currency", { ...base, ...eur, originalCurrency: "CAD", rate: "1", total: 8500, share: 8500 }),
    ledgerCase("unknown currency", { ...base, ...eur, originalCurrency: "XXX" }),
    ledgerCase("lower-case currency", { ...base, ...eur, originalCurrency: "eur" }),
    ledgerCase("rate that isn't canonical", { ...base, ...eur, rate: "1.46120" }),
    ledgerCase("zero rate", { ...base, ...eur, rate: "0" }),
    ledgerCase("zero original amount", { ...base, ...eur, originalAmount: 0 }),
    ledgerCase("unknown rate status", { ...base, ...eur, rateStatus: "manual" }),
    ledgerCase("yen entry with no decimals", { ...base, originalAmount: 13700, originalCurrency: "JPY", rate: "0.00906283", rateStatus: "published", rateDate: "2026-11-03", total: 12416, share: 12416 }),
    ledgerCase("euro home with a dollar entry", { ...base, originalAmount: 3499, originalCurrency: "USD", rate: "0.9248", rateStatus: "published", rateDate: "2026-11-03", total: 3236, share: 3236 }, "transaction", "EUR"),
    ledgerCase("home currency outside the home list", { ...base }, "transaction", "JPY"),
    ledgerCase("recurring rule in another currency", { ...base, ...eur }, "recurring"),
  ];
  // Contract 2.6.0: a personal trip may carry its currency.
  const tripCase = (name: string, trip: object) => {
    const value = {
      version: 4, currency: "CAD", accounts: [], categories: [{ id: "food", name: "Food", icon: "cafe-outline", color: "#E47850", kind: "expense" }],
      trips: [{ id: "lisbon", name: "Lisbon", startDate: "2026-11-12", endDate: "2026-11-19", ...trip }], transactions: [], recurring: [],
    };
    return { name, ledger: value, valid: ledgerWriteSchema.safeParse({ revision: 0, ledger: value }).success };
  };
  ledgers.push(
    tripCase("trip in euros", { currency: "EUR" }),
    tripCase("trip in the home currency", { currency: "CAD" }),
    tripCase("trip in yen", { currency: "JPY" }),
    tripCase("trip with an unknown currency", { currency: "XXX" }),
    tripCase("trip with a lower-case currency", { currency: "eur" }),
  );
  return {
    generator,
    description: "MAZ-151: entries in several currencies. currencies is every ISO 4217 currency an entry may use with its minor units (homeCurrencies the ones a ledger may use); amounts are integers in minor units; a rate is a canonical decimal string of home units per unit; conversion rounds once, half up, to the home currency's minor units; cross rates round half up to 6 significant digits (at most 8 fraction digits); a date uses the latest publication on or before it, and one after every publication uses the latest provisionally.",
    currencies: currencies.map(({ code, name, minorUnits }) => ({ code, name, minorUnits })),
    homeCurrencies,
    parse, rates, conversions, crossRates, rateDates, entryAmounts: entryCases, reconversions, ledgers,
  };
}

// MAZ-151 phase 2: shared expenses in several currencies. The Lisbon trip of the trip-currencies
// cards: a euro trip with expenses paid in EUR, USD and CAD, seen by a member whose home is CAD.
function sharedCurrency() {
  const lisbon = [
    { id: "fado", title: "Fado tickets", totalCents: 12000, shareCents: 3000 },
    { id: "insurance", title: "Travel insurance", totalCents: 1526, shareCents: 763, originalAmount: 2230, originalCurrency: "CAD" },
    { id: "apartment", title: "Apartment", totalCents: 25600, shareCents: 6400 },
    { id: "flights", title: "Flights", totalCents: 56400, shareCents: 14100, originalAmount: 60000, originalCurrency: "USD" },
  ];
  const memberCase = ({ totalCents, originalAmount, originalCurrency }: { totalCents: number; originalAmount?: number; originalCurrency?: string }, shareCents: number, household: string, home: string, rate: string | null, name: string) => {
    const expense = { totalCents, ...(originalAmount !== undefined && { originalAmount }), ...(originalCurrency !== undefined && { originalCurrency }) };
    const result = attempt(() => memberAmounts(expense, shareCents, household, home, rate));
    return { name, expense, shareCents, householdCurrency: household, home, rate, ...("value" in result ? { expected: result.value } : { error: result.error }) };
  };
  const members = [
    memberCase(lisbon[0], 3000, "EUR", "CAD", "1.463", "euro expense in a euro trip, CAD home"),
    memberCase(lisbon[1], 763, "EUR", "CAD", null, "paid in the home currency needs no rate"),
    memberCase(lisbon[1], 763, "EUR", "CAD", "1.461", "paid in the home currency ignores a rate"),
    memberCase(lisbon[2], 6400, "EUR", "CAD", "1.458", "share keeps its proportion, half up"),
    memberCase(lisbon[3], 14100, "EUR", "CAD", "1.373", "converts from what was paid, not the trip amount"),
    memberCase(lisbon[3], 0, "EUR", "CAD", "1.373", "zero share"),
    memberCase(lisbon[3], 56400, "EUR", "CAD", "1.373", "whole share stays whole"),
    memberCase(lisbon[0], 3000, "EUR", "CAD", null, "no rate known"),
    memberCase(lisbon[0], 3000, "EUR", "EUR", null, "household in the home currency"),
    memberCase(lisbon[3], 14100, "EUR", "EUR", null, "household in the home currency keeps the trip amount"),
    memberCase({ totalCents: 1001 }, 334, "CAD", "JPY", "109.5", "yen home has no minor units"),
    memberCase({ totalCents: 120000 }, 40000, "JPY", "KWD", "0.00203", "yen trip, dinar home"),
    memberCase({ totalCents: 1001 }, 1002, "CAD", "EUR", "0.68", "share above the total"),
  ];
  // Trip-wide balances of the Lisbon trip, in euros.
  const balances = [
    { userId: "jo", balanceCents: -11500 }, { userId: "mira", balanceCents: -22737 }, { userId: "sam", balanceCents: 32900 }, { userId: "you", balanceCents: 1337 },
  ];
  const settleCase = (name: string, input: typeof balances, from: string, to: string, rate: string) => {
    const result = attempt(() => settleIn(input, from, to, rate));
    return { name, balances: input, from, to, rate, ...("value" in result ? { expected: result.value } : { error: result.error }) };
  };
  const settles = [
    settleCase("in the trip's currency", balances, "EUR", "EUR", "1"),
    settleCase("in Canadian dollars at today's rate", balances, "EUR", "CAD", "1.463"),
    settleCase("in US dollars", balances, "EUR", "USD", "1.0631"),
    settleCase("in yen, no minor units", balances, "EUR", "JPY", "161.23"),
    settleCase("each figure rounds on its own", [{ userId: "a", balanceCents: -5 }, { userId: "b", balanceCents: -5 }, { userId: "c", balanceCents: 10 }], "EUR", "CAD", "1.5"),
    settleCase("balances that don't net to zero", [{ userId: "a", balanceCents: -5 }, { userId: "b", balanceCents: 6 }], "EUR", "CAD", "1.5"),
  ];
  const categories: Ledger["categories"] = [{ id: "food", name: "Food", icon: "cafe-outline", color: "#E47850", kind: "expense" }];
  const base = ledger([], { categories });
  const travel = { name: "Travel", icon: "airplane-outline", color: "#5B7DB1" };
  const row = (item: Partial<ProjectedExpense> & { id: string; totalCents: number; shareCents: number }): ProjectedExpense => ({
    householdId: "lisbon", householdName: "Lisbon", householdCurrency: "EUR", title: item.id, date: "2026-11-03",
    category: travel, note: "", payerUserId: "sam", ...item,
  });
  const projection = [
    row({ id: "fado", totalCents: 12000, shareCents: 3000, date: "2026-11-27", home: { currency: "CAD", totalCents: 17556, shareCents: 4389, rate: "1.463", rateStatus: "provisional", rateDate: "2026-11-26" } }),
    row({ id: "insurance", totalCents: 1526, shareCents: 763, originalAmount: 2230, originalCurrency: "CAD", rate: "0.6843", rateStatus: "published", rateDate: "2026-11-03", home: { currency: "CAD", totalCents: 2230, shareCents: 1115 } }),
    row({ id: "flights", totalCents: 56400, shareCents: 14100, date: "2026-10-02", originalAmount: 60000, originalCurrency: "USD", rate: "0.94", rateStatus: "published", rateDate: "2026-10-02", home: { currency: "CAD", totalCents: 82380, shareCents: 20595, rate: "1.373", rateStatus: "published", rateDate: "2026-10-02" } }),
    // No rate was known for the viewer's home currency: left out.
    row({ id: "no-rate", totalCents: 5000, shareCents: 2500 }),
    // Home amounts for another currency than the ledger's: left out.
    row({ id: "other-home", totalCents: 5000, shareCents: 2500, home: { currency: "USD", totalCents: 5316, shareCents: 2658, rate: "1.0631", rateStatus: "published", rateDate: "2026-11-03" } }),
    // A Canadian-dollar household: its own amounts, and what was paid when that was another currency.
    row({ id: "maison-tapas", householdId: "maison", householdName: "Maison", householdCurrency: "CAD", totalCents: 12420, shareCents: 6210, originalAmount: 8500, originalCurrency: "EUR", rate: "1.4612", rateStatus: "published", rateDate: "2026-11-03" }),
    row({ id: "maison-hydro", householdId: "maison", householdName: "Maison", householdCurrency: "CAD", totalCents: 9000, shareCents: 4500 }),
  ];
  const view = ledgerWithHouseholds(base, projection);
  const pick = ["id", "total", "share", "originalAmount", "originalCurrency", "rate", "rateStatus", "rateDate"] as const;
  const joined = view.transactions.map((entry) => Object.fromEntries(pick.filter((key) => (entry as Record<string, unknown>)[key] !== undefined).map((key) => [key, (entry as Record<string, unknown>)[key]])));
  const expense = { totalCents: 56400, originalAmount: 60000, originalCurrency: "USD", rate: "0.94", rateStatus: "published", rateDate: "2026-10-02" };
  const { rateDate: _date, ...undated } = expense;
  const expenseCase = (name: string, value: object, household = "EUR") => ({ name, householdCurrency: household, expense: value, problem: sharedExpenseCurrencyProblem(value as { totalCents: number }, household) });
  const expenses = [
    expenseCase("paid in the trip's currency", { totalCents: 12000 }),
    expenseCase("paid in US dollars", expense),
    expenseCase("total that doesn't match the conversion", { ...expense, totalCents: 56401 }),
    expenseCase("paid in the trip's own currency", { ...expense, originalCurrency: "EUR", rate: "1", totalCents: 60000 }),
    expenseCase("edited rate", { ...undated, rateStatus: "edited" }),
    expenseCase("published rate without its date", undated),
    expenseCase("original amount without a rate", { totalCents: 56400, originalAmount: 60000, originalCurrency: "USD" }),
    expenseCase("yen trip with a dollar expense", { totalCents: 9674, originalAmount: 6000, originalCurrency: "USD", rate: "161.23", rateStatus: "provisional", rateDate: "2026-11-26" }, "JPY"),
  ];
  return {
    generator,
    description: "MAZ-151 phase 2: shared expenses in several currencies. A household's (shared trip's) currency is the one its balances and settle-up use; a shared expense paid in another currency stores what was paid, that currency and the rate (household units per unit), with totalCents and splits converted at its date's rate (the personal entry rules, with the household's currency as home: expenses). memberAmounts is a member's view in their home currency: converted from what was paid at the home rate for the expense date, half up (exact when paid in the home currency, the household's own amounts when it is the home currency, null when a rate is needed and none is known); the share keeps its proportion of the total, half up. settleIn shows balances and suggested payments in another currency at one rate: payments are suggested in the household's currency, then each figure converts on its own, half up, keeping its sign. projection is joined into the personal view (ledgerWithHouseholds): a row counts at its home amounts with what was paid when that isn't the home currency, a row in another currency without home amounts for the ledger's currency is left out.",
    memberAmounts: members,
    settleIn: settles,
    expenses,
    projection: { ledger: base, rows: projection, expected: joined },
  };
}

// MAZ-136: Left to spend (recorded) versus Projected around today. Income dated after the
// person's local date is expected: it counts toward Projected, not Left to spend, until its
// date. Income only; future-dated expenses and investments stay recorded (MAZ-139).
function monthTotals() {
  const entry = (id: string, kind: string, categoryId: string, share: number, date: string) =>
    ({ id, title: id, kind, total: share, share, categoryId, date, note: "" });
  const categories: Ledger["categories"] = [
    { id: "food", name: "Food", icon: "cafe-outline", color: "#E47850", kind: "expense" },
    { id: "salary", name: "Salary", icon: "cash-outline", color: "#3E8E5E", kind: "income" },
    { id: "investments", name: "Investments", icon: "trending-up-outline", color: "#5B7DB1", kind: "investment" },
  ];
  const rule = (id: string, kind: string, categoryId: string, share: number, nextDate: string, anchorDay: number) =>
    ({ ...entry(id, kind, categoryId, share, "2026-09-01"), frequency: "monthly", nextDate, anchorDay, active: true });
  const recurring = [rule("pay", "income", "salary", 200000, "2026-10-30", 30), rule("gym", "expense", "food", 4000, "2026-10-28", 28)] as Ledger["recurring"];
  const october = [
    entry("september-pay", "income", "salary", 300000, "2026-09-30"),
    entry("salary", "income", "salary", 250000, "2026-10-01"),
    entry("rent", "expense", "food", 120000, "2026-10-01"),
    entry("bonus", "income", "salary", 40000, "2026-10-15"),
    entry("freelance", "income", "salary", 60000, "2026-10-16"),
    entry("concert", "expense", "food", 9000, "2026-10-20"),
    entry("etf", "investment", "investments", 50000, "2026-10-25"),
    entry("refund", "income", "salary", 2500, "2026-10-31"),
    entry("november-pay", "income", "salary", 100000, "2026-11-01"),
  ];
  const ledgers = {
    october: ledger(october, { categories, recurring }),
    // The 2026-10-30 pay was recorded ahead of its date (its occurrence id is in the ledger):
    // it replaces the preview and is expected by its date like any other income.
    "pay-recorded-early": ledger([...october, { ...entry("pay:2026-10-30", "income", "salary", 200000, "2026-10-30"), title: "pay", recurringId: "pay" }], { categories, recurring }),
  };
  const todayCases = ([
    ["2026-10-16T02:30:00Z", "America/Toronto"], ["2026-10-16T02:30:00Z", "UTC"], ["2026-10-15T15:30:00Z", "Asia/Tokyo"],
    ["2026-10-15T15:30:00Z", "America/Vancouver"], ["2026-10-15T10:30:00Z", "Pacific/Kiritimati"], ["2026-10-16T09:30:00Z", "Pacific/Pago_Pago"],
    ["2026-11-01T05:30:00Z", "America/Toronto"], ["2026-10-31T23:59:59Z", "Europe/London"], ["2026-03-08T07:30:00Z", "America/Toronto"],
  ] as const).map(([instant, timeZone]) => ({ instant, timeZone, today: dateKeyIn(new Date(instant), timeZone) }));
  const clocks = (instant: string, timeZone: string) => ({ instant, timeZone });
  const inputs: { name: string; ledger: keyof typeof ledgers; today: string; clock?: { instant: string; timeZone: string } }[] = [
    { name: "income dated today is recorded; income dated tomorrow is expected", ledger: "october", today: "2026-10-15" },
    { name: "the day before, income dated today is still expected", ledger: "october", today: "2026-10-14" },
    { name: "on the last day of the month every dated entry is recorded", ledger: "october", today: "2026-10-31" },
    { name: "a month still ahead: all its income is expected", ledger: "october", today: "2026-09-20" },
    { name: "a past month: everything dated is recorded", ledger: "october", today: "2026-11-11" },
    { name: "time zone: 02:30 UTC on Oct 16 is still Oct 15 in Toronto, so Oct 16 income is expected", ledger: "october", today: dateKeyIn(new Date("2026-10-16T02:30:00Z"), "America/Toronto"), clock: clocks("2026-10-16T02:30:00Z", "America/Toronto") },
    { name: "time zone: the same instant in UTC is Oct 16, so Oct 16 income is recorded", ledger: "october", today: dateKeyIn(new Date("2026-10-16T02:30:00Z"), "UTC"), clock: clocks("2026-10-16T02:30:00Z", "UTC") },
    { name: "an occurrence recorded ahead of its date replaces its preview and stays expected", ledger: "pay-recorded-early", today: "2026-10-15" },
  ];
  const cases = inputs.map((input) => {
    const breakdown = monthBreakdown(ledgers[input.ledger], "2026-10", { today: input.today });
    const summary = summarizeMonth(ledgers[input.ledger], "2026-10", { today: input.today });
    return {
      ...input, month: "2026-10",
      expected: {
        recorded: summary.recorded, projected: summary.projected, expectedIncome: summary.expectedIncome,
        recordedNet: summary.recordedNet, projectedNet: summary.projectedNet,
        // Ledger entries shown as expected (amber ring) and the scheduled previews, by id.
        expectedIds: breakdown.expected.map((item) => item.id).sort(),
        scheduledIds: breakdown.scheduled.map((item) => item.id).sort(),
      },
    };
  });
  return {
    generator,
    description: "Left to spend (recorded) versus Projected around today (MAZ-136). Income dated after the person's local date is expected: it counts toward Projected, not recorded totals or Left to spend, until its date; the entry itself never changes. Projected also adds every scheduled occurrence not yet recorded. Scope: income only; future-dated expenses and investment contributions stay recorded (MAZ-139). `todayCases` turn an instant and an IANA time zone into the local date.",
    todayCases, ledgers, cases,
  };
}

// MAZ-286: a shared expense counts under the person's expense category with the same name
// (trimmed, without case; icon and colour may differ), the first in ledger order. Income and
// investment categories never match; a shared category with no match keeps its own
// `household-category:` row. Expectations: each row's category id in the view, the categories
// the view adds, and October's spending by category id (`summarizeMonth` totals per category).
function sharedCategories() {
  const categories: Ledger["categories"] = [
    { id: "sports", name: "Sports", icon: "football-outline", color: "#3E8E5E", kind: "expense" },
    { id: "food", name: "Food", icon: "cafe-outline", color: "#E47850", kind: "expense" },
    // Differs from "Food" only in case: the first in ledger order wins.
    { id: "food-2", name: "FOOD", icon: "pizza-outline", color: "#B15B7D", kind: "expense" },
    { id: "gifts-in", name: "Gifts", icon: "gift-outline", color: "#5B7DB1", kind: "income" },
    { id: "savings", name: "Savings", icon: "trending-up-outline", color: "#5B7DB1", kind: "investment" },
  ];
  const personal = [
    { id: "tennis", title: "Tennis", kind: "expense", total: 4000, share: 4000, categoryId: "sports", date: "2026-10-03", note: "" },
    { id: "lunch", title: "Lunch", kind: "expense", total: 1500, share: 1500, categoryId: "food", date: "2026-10-04", note: "" },
  ];
  const base = ledger(personal, { categories });
  const row = (id: string, shareCents: number, category: ProjectedExpense["category"]): ProjectedExpense => ({
    id, householdId: "maison", householdName: "Maison", householdCurrency: base.currency, title: id, date: "2026-10-10",
    totalCents: shareCents * 2, shareCents, category, note: "", payerUserId: "bea",
  });
  const projection = [
    row("ski-pass", 6000, { name: "Sports", icon: "football-outline", color: "#3E8E5E" }),
    // Same name, another icon and colour, other case and padding: still the personal Sports.
    row("climbing", 2500, { name: "  sports ", icon: "trophy-outline", color: "#123456" }),
    row("groceries", 3000, { name: "food", icon: "basket-outline", color: "#0FA3A3" }),
    // Only an income category is called Gifts: a shared expense never joins it.
    row("present", 2000, { name: "Gifts", icon: "gift-outline", color: "#5B7DB1" }),
    row("hydro", 4500, { name: "Utilities", icon: "flash-outline", color: "#3B82F6" }),
    row("internet", 1500, { name: "Utilities", icon: "flash-outline", color: "#3B82F6" }),
    row("savings-pot", 1000, { name: "Savings", icon: "wallet-outline", color: "#5B7DB1" }),
  ];
  const view = ledgerWithHouseholds(base, projection);
  const viewIds = new Map(view.transactions.map((entry) => [entry.id, entry.categoryId]));
  const spending: Record<string, number> = {};
  for (const entry of monthBreakdown(view, "2026-10", { today: "2026-10-31" }).recordedEntries)
    if (entry.kind === "expense") spending[entry.categoryId] = (spending[entry.categoryId] ?? 0) + entry.share;
  return {
    generator,
    description: "Shared expenses in the personal view (MAZ-286). A shared expense carries its household's category by value; it counts under the person's expense category with the same name, compared trimmed and without case (icon and colour may differ), the first in ledger order. Income and investment categories never match. With no match it gets its own expense category `household-category:<name>:<icon>:<color>`, added to the view once. `expected.categoryIds` maps each projection row id to its category id in the view; `expected.addedCategories` lists the categories the view adds, in order; `expected.spending` is the month's recorded expense share per category id.",
    month: "2026-10",
    ledger: base,
    projection: projection.map(({ id, householdId, date, totalCents, shareCents, category }) => ({ id, householdId, date, totalCents, shareCents, category })),
    expected: {
      categoryIds: Object.fromEntries(projection.map((item) => [item.id, viewIds.get(`household:${item.householdId}:${item.id}`)!])),
      addedCategories: view.categories.slice(categories.length),
      spending,
    },
  };
}

// MAZ-292: the monthly recap (`monthReview`). Recorded entries only, shared expenses at your share
// through `ledgerWithHouseholds` (a row in another currency is left out), compared with the month
// before and the same month last year. Each case's expectation is the whole `MonthReview`.
function monthReviews() {
  const categories: Ledger["categories"] = [
    { id: "groceries", name: "Groceries", icon: "basket-outline", color: "#2F9E6B", kind: "expense" },
    { id: "food", name: "Food & drinks", icon: "cafe-outline", color: "#E47850", kind: "expense" },
    { id: "fun", name: "Entertainment", icon: "musical-notes-outline", color: "#8E5BB1", kind: "expense" },
    { id: "transport", name: "Transport", icon: "bus-outline", color: "#3B82F6", kind: "expense" },
    { id: "salary", name: "Salary", icon: "cash-outline", color: "#3E8E5E", kind: "income" },
    { id: "savings", name: "Investments", icon: "trending-up-outline", color: "#5B7DB1", kind: "investment" },
  ];
  const entry = (id: string, kind: string, categoryId: string, share: number, date: string, total = share) =>
    ({ id, title: id, kind, total, share, categoryId, date, note: "" });
  const history = [
    // October last year, and September: the months October is compared with.
    entry("groceries-2025", "expense", "groceries", 214000, "2025-10-12"),
    entry("groceries-sep", "expense", "groceries", 25620, "2026-09-05"),
    entry("food-sep", "expense", "food", 28045, "2026-09-12"),
    entry("transport-sep", "expense", "transport", 6000, "2026-09-20"),
    entry("salary-sep", "income", "salary", 320000, "2026-09-30"),
  ];
  const october = [
    entry("salary-oct", "income", "salary", 320000, "2026-10-01"),
    entry("groceries-oct", "expense", "groceries", 30240, "2026-10-02"),
    // Split with a friend: you paid $246.80 of $493.60.
    entry("dinner", "expense", "food", 24680, "2026-10-09", 49360),
    entry("concert", "expense", "fun", 5350, "2026-10-18"),
    entry("tfsa", "investment", "savings", 20000, "2026-10-25"),
    // Income dated after the 15th: expected, not recorded, when today is Oct 15.
    entry("refund", "income", "salary", 2500, "2026-10-28"),
  ];
  const rule = { ...entry("gym", "expense", "transport", 4000, "2026-09-01"), frequency: "monthly", nextDate: "2026-10-28", anchorDay: 28, active: true };
  const ledgers = {
    alex: ledger([...history, ...october], { categories, recurring: [rule] as Ledger["recurring"] }),
    // Only a schedule in November: previews never count, so November has nothing to recap.
    "previews-only": ledger(history, { categories, recurring: [{ ...rule, nextDate: "2026-11-28" }] as Ledger["recurring"] }),
    // The first month with anything recorded is October.
    "first-month": ledger(october, { categories }),
    // Recorded since September only: no October last year.
    "first-year": ledger([...history.slice(1), ...october], { categories }),
  };
  const shared = (id: string, shareCents: number, totalCents: number, date: string, paidByYou: boolean, extra: Partial<ProjectedExpense> = {}): ProjectedExpense => ({
    id, householdId: "apartment", householdName: "Apartment", householdCurrency: "CAD", title: id, date, totalCents, shareCents,
    category: { name: "groceries", icon: "basket-outline", color: "#0FA3A3" }, note: "", payerUserId: paidByYou ? "me" : "jo",
    payer: paidByYou ? { email: "me@example.test", displayName: "Alex" } : { email: "jo@example.test", displayName: "Jo" }, paidByYou, ...extra,
  });
  const projections = {
    none: [],
    apartment: [
      shared("costco", 6140, 18420, "2026-10-14", false),
      shared("hydro", 4000, 8000, "2026-10-20", true, { category: { name: "Utilities", icon: "flash-outline", color: "#3B82F6" } }),
      // A deleted payer: the client shows "Former member".
      shared("pharmacy", 1200, 2400, "2026-10-22", false, { payer: { email: "gone@example.test", deleted: true } }),
      // Another currency than the ledger's: left out.
      shared("lisbon-dinner", 9000, 18000, "2026-10-16", false, { householdId: "lisbon", householdName: "Lisbon", householdCurrency: "EUR" }),
      // A shared preview: never counted.
      shared("internet", 3000, 6000, "2026-10-29", true, { scheduled: true, recurringId: "internet-rule" }),
      shared("costco-sep", 5000, 10000, "2026-09-18", false),
    ],
  };
  const inputs: { name: string; ledger: keyof typeof ledgers; projection: keyof typeof projections; month: string; today: string }[] = [
    { name: "October, with September and October last year to compare with", ledger: "alex", projection: "apartment", month: "2026-10", today: "2026-11-03" },
    { name: "October without shared expenses", ledger: "alex", projection: "none", month: "2026-10", today: "2026-11-03" },
    { name: "the month still under way: days without spending count up to today, and later income is expected", ledger: "alex", projection: "apartment", month: "2026-10", today: "2026-10-15" },
    { name: "a month with no entries", ledger: "alex", projection: "none", month: "2026-08", today: "2026-11-03" },
    { name: "a month with only previews", ledger: "previews-only", projection: "none", month: "2026-11", today: "2026-12-02" },
    { name: "a first month: nothing to compare with, and no category changes", ledger: "first-month", projection: "none", month: "2026-10", today: "2026-11-03" },
    { name: "a first year: September to compare with, no October last year", ledger: "first-year", projection: "none", month: "2026-10", today: "2026-11-03" },
    { name: "the month after: categories that stopped are -100%", ledger: "alex", projection: "none", month: "2026-11", today: "2026-12-02" },
  ];
  const cases = inputs.map((input) => ({
    ...input,
    expected: monthReview(ledgerWithHouseholds(ledgers[input.ledger], projections[input.projection]), input.month, { today: input.today }),
  }));
  const banner = ["2026-11-01", "2026-11-07", "2026-11-08", "2026-11-30", "2027-01-03", "2026-03-01"].map((today) => ({ today, month: reviewBannerMonth(today) }));
  return {
    generator,
    description: "The monthly recap (MAZ-292, `monthReview` in apps/web/src/domain/monthReview.ts). Recorded entries only, never scheduled previews; shared expenses count at your share through the household projection, and shared rows in another currency are left out. Spending is compared with the month before and the same month last year; a month is null (\"No September to compare with\") when nothing is recorded in or before it. Percentages are whole numbers rounded half away from zero, null when there is nothing to compare with; a category with nothing the month before has a null percent (\"New\"). Split expenses are recorded expenses whose total is above your share; othersPaid is total minus share. Days without spending count the month's days up to today with no recorded expense; the longest run is the earliest on a tie. The banner shows last month's recap during the first 7 days of a month.",
    ledgers, projections, cases, banner,
  };
}

// Recurring suggestions (src/domain/suggestions.ts): each case is a ledger and a day, and the
// suggestions it gives. The Swift rule (RecurringSuggestions.swift) must give the same.
function recurringSuggestionCases() {
  const categories: Ledger["categories"] = [
    { id: "fun", name: "Entertainment", icon: "musical-notes-outline", color: "#9D83BA", kind: "expense" },
    { id: "food", name: "Food", icon: "cafe-outline", color: "#E47850", kind: "expense" },
    { id: "health", name: "Health", icon: "heart-outline", color: "#6C9C79", kind: "expense" },
    { id: "salary", name: "Salary", icon: "briefcase-outline", color: "#6C9C79", kind: "income" },
    { id: "investments", name: "Investments", icon: "trending-up-outline", color: "#678DB1", kind: "investment" },
  ];
  type Entry = Ledger["transactions"][number];
  const series = (id: string, title: string | string[], dates: string[], shares: number | number[], extra: Partial<Entry> = {}): Entry[] =>
    dates.map((date, index) => {
      const share = Array.isArray(shares) ? shares[index] as number : shares;
      return {
        id: `${id}-${String(index + 1)}`, title: Array.isArray(title) ? title[index % title.length] as string : title, kind: "expense",
        total: share, share, categoryId: "fun", accountId: "chq", date, note: "", ...extra,
      };
    });
  const book = (transactions: Entry[], extra: Partial<Ledger> = {}): Ledger => ({ ...ledger(transactions, extra), categories });
  const netflix = series("netflix", "Netflix", ["2026-08-03", "2026-09-03", "2026-10-03", "2026-11-03"], [1549, 1549, 1699, 1699]);
  const cases: { name: string; today: string; ledger: Ledger }[] = [
    { name: "monthly expense after a price step that held: the newest amount, was the old one", today: "2026-11-20", ledger: book(netflix) },
    { name: "weekly income", today: "2026-11-20", ledger: book(series("tutoring", "Tutoring", ["2026-10-07", "2026-10-14", "2026-10-21", "2026-10-28", "2026-11-04", "2026-11-11", "2026-11-18"], 6000, { kind: "income", categoryId: "salary", accountId: undefined })) },
    { name: "monthly investment", today: "2026-11-20", ledger: book(series("tfsa", "TFSA contribution", ["2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01"], 20000, { kind: "investment", categoryId: "investments" })) },
    { name: "anchor day 31 keeps the last day in shorter months", today: "2026-11-05", ledger: book(series("rent", "Rent", ["2026-07-31", "2026-08-31", "2026-09-30", "2026-10-31"], 145000, { categoryId: "food" })) },
    { name: "yearly on a leap day: two entries, the anchor stays the 29th", today: "2025-11-20", ledger: book(series("domain", "Domain name", ["2024-02-29", "2025-02-28"], 2400)) },
    { name: "a skipped month among six: 80% of the gaps still fit", today: "2026-11-20", ledger: book(series("gym", "Gym", ["2026-04-18", "2026-05-18", "2026-07-18", "2026-08-18", "2026-09-18", "2026-10-18", "2026-11-18"], 4500, { categoryId: "health" })) },
    { name: "a skipped month among four: too few gaps fit", today: "2026-11-20", ledger: book(series("gym", "Gym", ["2026-07-18", "2026-09-18", "2026-10-18", "2026-11-18"], 4500, { categoryId: "health" })) },
    { name: "near-duplicate titles group together; the most common category wins", today: "2026-11-20", ledger: book([
      ...series("spotify", ["Spotify Premium Inc.", "SPOTIFY premium", "Spotify Prémium #12"], ["2026-08-12", "2026-09-12", "2026-10-12"], 1299),
      ...series("spotify-food", "spotify premium subscription", ["2026-11-12"], 1299, { categoryId: "food" }),
    ]) },
    { name: "entries a schedule recorded are left out", today: "2026-11-20", ledger: book(series("pass", "Transit pass", ["2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01"], 15600, { recurringId: "pass-rule" })) },
    { name: "a group an existing schedule covers is left out", today: "2026-11-20", ledger: book(netflix, { recurring: [{ id: "netflix-rule", title: "NETFLIX subscription", kind: "expense", total: 1699, share: 1699, categoryId: "fun", accountId: "chq", date: "2026-12-03", note: "", frequency: "monthly", nextDate: "2026-12-03", anchorDay: 3, active: false }] }) },
    { name: "a dismissed suggestion stays hidden while its amount holds", today: "2026-11-20", ledger: book(netflix, { dismissedSuggestions: ["expense|netflix|monthly|1699"] }) },
    { name: "a dismissed suggestion comes back when its amount moves more than 25%", today: "2026-11-20", ledger: book(netflix, { dismissedSuggestions: ["expense|netflix|monthly|1299"] }) },
    { name: "groceries with uneven amounts are not suggested", today: "2026-11-20", ledger: book(series("groceries", "Groceries", ["2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30", "2026-11-06", "2026-11-13"], [8642, 4210, 12750, 3999, 9120, 6400, 15030], { categoryId: "food" })) },
    { name: "a price step that didn't hold yet is not suggested", today: "2026-11-20", ledger: book(series("cloud", "Cloud storage", ["2026-08-05", "2026-09-05", "2026-10-05", "2026-11-05"], [1000, 1000, 1000, 1500])) },
    { name: "stale: the latest entry is more than 1.5 intervals ago", today: "2026-11-20", ledger: book(series("magazine", "Magazine", ["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"], 1200)) },
    { name: "two monthly entries are too few", today: "2026-11-20", ledger: book(series("lunch", "Lunch club", ["2026-10-10", "2026-11-10"], 2500, { categoryId: "food" })) },
    { name: "entries after today are left out, and the next date follows today", today: "2026-11-20", ledger: book(series("phone", "Phone", ["2026-08-20", "2026-09-20", "2026-10-20", "2026-11-20", "2026-12-20"], 5500)) },
    { name: "small changes within $2 or 10% are steady: the newest amount, no was", today: "2026-11-20", ledger: book(series("hydro", "Hydro", ["2026-07-15", "2026-08-15", "2026-09-15", "2026-10-15", "2026-11-15"], [9100, 9350, 8900, 9020, 9480], { categoryId: "food" })) },
    { name: "the same title as an expense and as income are separate groups", today: "2026-11-20", ledger: book([
      ...series("club-out", "Book club", ["2026-09-09", "2026-10-09", "2026-11-09"], 1500),
      ...series("club-in", "Book club", ["2026-09-10", "2026-10-10", "2026-11-10"], 3000, { kind: "income", categoryId: "salary" }),
    ]) },
  ];
  const titles = ["Netflix", "NETFLIX.COM", "Netflix Inc.", "Café Olé", "Spotify Premium #12", "Hydro-Québec bill", "Monthly payment", "Æsop Ltd", "  ", "123"];
  return {
    generator,
    description: "Recurring suggestions: the normalised title key of each title, and for each ledger and day, the suggestions Penny offers (src/domain/suggestions.ts and RecurringSuggestions.swift give the same).",
    keys: titles.map((title) => ({ title, key: suggestionKey(title) })),
    cases: cases.map((item) => ({ ...item, expected: JSON.parse(JSON.stringify(recurringSuggestions(item.ledger, item.today))) as unknown })),
  };
}

// Dismissed recurring suggestions merge as a set union, less what this device undid (contract 2.3.0).
function dismissalMergeCases() {
  const base = ledger([], { dismissedSuggestions: ["expense|netflix|monthly|1699"] });
  return [
    { name: "dismissals: both sides' dismissals are kept, the server's first", base, local: ledger([], { dismissedSuggestions: ["expense|netflix|monthly|1699", "income|tutoring|weekly|6000"] }), remote: ledger([], { dismissedSuggestions: ["expense|netflix|monthly|1699", "expense|gym|monthly|4500"] }) },
    { name: "dismissals: an Undo on this device stays undone", base, local: ledger([]), remote: ledger([], { dismissedSuggestions: ["expense|netflix|monthly|1699", "expense|gym|monthly|4500"] }) },
    { name: "dismissals: the first dismissal on a ledger that had none", base: ledger([]), local: ledger([], { dismissedSuggestions: ["expense|gym|monthly|4500"] }), remote: ledger([{ id: "lunch", title: "Lunch", kind: "expense", total: 1200, share: 1200, categoryId: "food", date: "2026-10-01", note: "" }]) },
  ];
}

// Which suites consume each fixture. A language with no implementation yet names the
// issue that adds it; a fixture only meaningful to some layers says so.
const consumers: Record<string, Record<string, string[] | string>> = {
  "money.json": { typescript: ["apps/web/tests/domain/golden-fixtures.test.ts"], csharp: ["apps/backend/tests/Penny.Backend.UnitTests/Contracts/GoldenFixtureTests.cs"], swift: ["contracts/swift/Tests/PennyContractsTests/FixtureDecodingTests.swift"] },
  "recurrence.json": { typescript: ["apps/web/tests/domain/golden-fixtures.test.ts"], csharp: ["apps/backend/tests/Penny.Backend.UnitTests/Contracts/GoldenFixtureTests.cs"], swift: ["contracts/swift/Tests/PennyContractsTests/FixtureDecodingTests.swift"] },
  "merge-conflicts.json": { typescript: ["apps/web/tests/domain/golden-fixtures.test.ts"], csharp: "not applicable: the server never merges; it rejects stale writes with 409 (http-journey.json)", swift: ["contracts/swift/Tests/PennyContractsTests/FixtureDecodingTests.swift", "apps/ios/Packages/PennyKit/Tests/PennyDomainTests/LedgerMergeTests.swift"] },
  "recurring-suggestions.json": { typescript: ["apps/web/tests/domain/golden-fixtures.test.ts"], csharp: ["apps/backend/tests/Penny.Backend.UnitTests/Contracts/GoldenFixtureTests.cs"], swift: ["contracts/swift/Tests/PennyContractsTests/FixtureDecodingTests.swift", "apps/ios/Packages/PennyKit/Tests/PennyDomainTests/RecurringSuggestionsTests.swift"] },
  "month-totals.json": { typescript: ["apps/web/tests/domain/golden-fixtures.test.ts"], csharp: "not applicable: Left to spend and Projected are client calculations; the seeded server's ledger is checked against redesign-states.json totals (FullStackSeedTests)", swift: ["contracts/swift/Tests/PennyContractsTests/FixtureDecodingTests.swift", "apps/ios/Packages/PennyKit/Tests/PennyDomainTests/ReportTests.swift"] },
  "month-review.json": { typescript: ["apps/web/tests/domain/golden-fixtures.test.ts"], csharp: "not applicable: client calculation; the recap is computed on the device", swift: ["contracts/swift/Tests/PennyContractsTests/FixtureDecodingTests.swift", "apps/ios/Packages/PennyKit/Tests/PennyDomainTests/MonthReviewTests.swift"] },
  "year-review.json": { typescript: ["apps/web/tests/domain/year-review.test.ts"], csharp: "not applicable: client calculation; the year in review is computed on the device", swift: ["contracts/swift/Tests/PennyContractsTests/FixtureDecodingTests.swift", "apps/ios/Packages/PennyKit/Tests/PennyDomainTests/YearReviewTests.swift"] },
  "shared-categories.json": { typescript: ["apps/web/tests/domain/golden-fixtures.test.ts"], csharp: "not applicable: shared expenses join the personal view on the client", swift: ["contracts/swift/Tests/PennyContractsTests/FixtureDecodingTests.swift", "apps/ios/Packages/PennyKit/Tests/PennyDomainTests/ReportTests.swift"] },
  "currency.json": { typescript: ["apps/web/tests/domain/golden-fixtures.test.ts"], csharp: ["apps/backend/tests/Penny.Backend.UnitTests/Contracts/CurrencyFixtureTests.cs"], swift: ["contracts/swift/Tests/PennyContractsTests/FixtureDecodingTests.swift", "apps/ios/Packages/PennyKit/Tests/PennyDomainTests/CurrencyTests.swift"] },
  "shared-currency.json": { typescript: ["apps/web/tests/domain/golden-fixtures.test.ts"], csharp: ["apps/backend/tests/Penny.Backend.UnitTests/Contracts/SharedCurrencyFixtureTests.cs"], swift: ["apps/ios/Packages/PennyKit/Tests/PennyDomainTests/SharedCurrencyTests.swift"] },
  "parity-cases.json": { typescript: ["apps/web/tests/domain/contracts.test.ts"], csharp: ["apps/backend/tests/Penny.Backend.UnitTests/Households/HouseholdSplitsTests.cs"], swift: ["contracts/swift/Tests/PennyContractsTests/FixtureDecodingTests.swift"] },
  "shared-splits.json": { typescript: ["apps/web/tests/domain/households-domain.test.ts"], csharp: ["apps/backend/tests/Penny.Backend.UnitTests/Households/HouseholdSplitsTests.cs"], swift: ["contracts/swift/Tests/PennyContractsTests/FixtureDecodingTests.swift"] },
  "settlement.json": { typescript: ["apps/web/tests/domain/households-domain.test.ts"], csharp: ["apps/backend/tests/Penny.Backend.UnitTests/Households/MonthlySettlementTests.cs"], swift: "MAZ-75 (shared settlement in Swift)" },
  "search-cases.json": { typescript: ["apps/web/tests/domain/contracts.test.ts", "apps/web/tests/domain/transactions.test.ts"], csharp: ["apps/backend/tests/Penny.Backend.UnitTests/Search/SearchTextTests.cs", "apps/backend/tests/Penny.Backend.IntegrationTests/Controllers/SearchFixtureTests.cs"], swift: "MAZ-73 (search screens and offline normalization in Swift)" },
  "http-journey.json": { typescript: ["apps/web/tests/domain/contracts.test.ts"], csharp: ["apps/backend/tests/Penny.Backend.IntegrationTests/Controllers/LedgerTests.cs"], swift: "MAZ-71 (Swift API client)" },
  "full-stack-seeds.json": { typescript: ["apps/web/tests/domain/golden-fixtures.test.ts", "scripts/tests/fullstack/environment.test.mjs"], csharp: ["apps/backend/tests/Penny.Backend.IntegrationTests/Contracts/FullStackSeedTests.cs"], swift: ["contracts/swift/Tests/PennyContractsTests/FixtureDecodingTests.swift"] },
  "redesign-states.json": { typescript: ["apps/web/tests/domain/golden-fixtures.test.ts"], csharp: "not applicable: client presentation states", swift: ["contracts/swift/Tests/PennyContractsTests/FixtureDecodingTests.swift"] },
};

export function serialize(value: unknown): string {
  // Non-ASCII is escaped so the bytes (and hashes) never depend on an editor's encoding.
  return `${JSON.stringify(value, null, 2).replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)}\n`;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

export function generated(): Record<string, string> {
  return {
    "money.json": serialize(money()),
    "currency.json": serialize(currency()),
    "shared-currency.json": serialize(sharedCurrency()),
    "recurrence.json": serialize(recurrence()),
    "merge-conflicts.json": serialize(merge()),
    "month-totals.json": serialize(monthTotals()),
    "shared-categories.json": serialize(sharedCategories()),
    "month-review.json": serialize(monthReviews()),
    "recurring-suggestions.json": serialize(recurringSuggestionCases()),
    "year-review.json": serialize(yearReviews(generator)),
  };
}

export function manifest(files: Record<string, string>): string {
  const read = (name: string) => files[name] ?? readFileSync(new URL(name, directory), "utf8");
  return serialize({
    version: 1,
    description: "Every shared fixture, its SHA-256 (LF line endings) and the suites consuming it. Regenerate with `node --experimental-strip-types apps/web/scripts/fixtures/generate-golden.ts`; tests in each language verify the hashes, so an unreviewed edit fails everywhere.",
    fixtures: Object.keys(consumers).sort().map((file) => ({
      file, sha256: sha256(read(file)), generatedBy: file in files ? generator : null, consumers: consumers[file],
    })),
  });
}

if (import.meta.main) {
  const files = generated();
  const all = { ...files, "manifest.json": manifest(files) };
  const check = process.argv.includes("--check");
  const stale = Object.entries(all).filter(([name, text]) => {
    let current = "";
    try {
      current = readFileSync(new URL(name, directory), "utf8");
    } catch {
      // Missing counts as stale.
    }
    return current.replace(/\r\n/g, "\n") !== text;
  });
  if (check) {
    if (stale.length) {
      console.error(`Stale fixtures: ${stale.map(([name]) => name).join(", ")}. Regenerate with node --experimental-strip-types ${generator}`);
      process.exit(1);
    }
    console.log("Golden fixtures and manifest are current.");
  } else {
    for (const [name, text] of stale) writeFileSync(new URL(name, directory), text);
    console.log(stale.length ? `Wrote ${stale.map(([name]) => name).join(", ")}` : "Nothing to change.");
  }
}
