import { afterEach, describe, expect, it } from "vitest";
import type { Ledger, Transaction } from "@domain/ledger.ts";
import { lastKnownRates, RATES_STORAGE_KEY, rememberRates } from "../src/api/rates";
import { exchangeRatesSchema, type ExchangeRates } from "../src/api/schemas";
import { demoRates } from "../src/demo/demoServer";
import { currencySymbolFor, currencyUses, displayRate, fitAmount, formatMinor, lastRateFor, menuSections, rateLine, resolveRate, usedText } from "../src/features/entries/currency";
import { buildEntry, draftFromEntry, newDraft, type EntryDraft } from "../src/features/entries/model";
import { provisionalDates, settleChange, settledEntries } from "../src/offline/provisionalRates";

// MAZ-151 phase 1: the web's wording and wiring around the shared currency rules. Synthetic data only.

afterEach(() => {
  localStorage.removeItem(RATES_STORAGE_KEY);
});

const answer = (extra: Partial<ExchangeRates> = {}): ExchangeRates => ({
  enabled: true,
  source: "European Central Bank",
  base: "CAD",
  date: "2026-11-03",
  rateDate: "2026-11-03",
  provisional: false,
  latestDate: "2026-11-06",
  rates: { EUR: "1.4612", USD: "1.373" },
  ...extra,
});

const tx = (id: string, extra: Partial<Transaction> = {}): Transaction => ({ id, title: id, kind: "expense", total: 1000, share: 1000, categoryId: "fun", date: "2026-11-03", note: "", ...extra });
const ledger = (transactions: Transaction[] = []): Ledger => ({
  version: 4,
  currency: "CAD",
  accounts: [],
  trips: [],
  categories: [{ id: "fun", name: "Fun", icon: "musical-notes-outline", color: "#C77DBA", kind: "expense" }],
  transactions,
  recurring: [],
});

describe("formatting", () => {
  it("writes foreign amounts with their symbol, prefixed when they share the home one", () => {
    expect(formatMinor(8500, "EUR", "CAD")).toBe("€85.00");
    expect(formatMinor(3499, "USD", "CAD")).toBe("US$34.99");
    expect(formatMinor(3499, "CAD", "USD")).toBe("CA$34.99");
    expect(formatMinor(1200, "JPY", "CAD")).toBe("¥1,200");
    expect(formatMinor(1250, "KWD", "CAD")).toMatch(/^KWD\s1\.250$/);
    expect(formatMinor(-8500, "EUR", "CAD", { signed: true })).toBe("−€85.00");
    expect(formatMinor(12420, "CAD", "CAD")).toBe("$124.20");
    expect(currencySymbolFor("AUD", "CAD")).toBe("A$");
  });

  it("writes rates with at least four decimals", () => {
    expect(displayRate("1.46")).toBe("1.4600");
    expect(displayRate("1.4612")).toBe("1.4612");
    expect(displayRate("0.00896412")).toBe("0.00896412");
    expect(rateLine("EUR", "1.4612", "CAD")).toBe("1 EUR = 1.4612 CAD");
  });

  it("drops digits beyond the new currency's minor units", () => {
    expect(fitAmount("85.25", "JPY")).toBe("85");
    expect(fitAmount("1.2345", "KWD")).toBe("1.234");
    expect(fitAmount("12", "EUR")).toBe("12");
    expect(fitAmount("12,5", "EUR")).toBe("12,5");
  });
});

describe("recent currencies", () => {
  const entries = [
    tx("a", { date: "2026-11-01", originalAmount: 100, originalCurrency: "EUR", rate: "1.46", rateStatus: "edited" }),
    tx("b", { date: "2026-11-05", originalAmount: 100, originalCurrency: "EUR", rate: "1.4612", rateStatus: "published", rateDate: "2026-11-05" }),
    tx("c", { date: "2026-10-02", originalAmount: 100, originalCurrency: "USD", rate: "1.37", rateStatus: "edited" }),
    tx("d"),
  ];

  it("counts each currency and keeps its latest rate, the most recent first", () => {
    expect(currencyUses({ transactions: entries })).toEqual([
      { code: "EUR", count: 2, lastRate: "1.4612", lastDate: "2026-11-05" },
      { code: "USD", count: 1, lastRate: "1.37", lastDate: "2026-10-02" },
    ]);
    expect(lastRateFor({ transactions: entries }, "USD")).toBe("1.37");
    expect(lastRateFor({ transactions: entries }, "JPY")).toBeNull();
    expect([1, 2, 3].map(usedText)).toEqual(["Used once", "Used twice", "Used 3 times"]);
  });
});

describe("the currency menu", () => {
  it("suggests the home currency, then recent ones, then all A–Z", () => {
    const sections = menuSections("", "CAD", ["EUR", "CAD", "JPY"]);
    expect(sections.map((section) => section.title)).toEqual(["Suggested", "Recent", "All currencies"]);
    expect(sections[0]?.items.map((item) => [item.info.code, item.note])).toEqual([["CAD", "Home"]]);
    expect(sections[1]?.items.map((item) => [item.info.code, item.note])).toEqual([["EUR", null], ["JPY", "No decimals"]]);
    expect(sections[2]?.items[0]?.info.code).toBe("AED");
    expect(sections[2]?.items.find((item) => item.info.code === "USD")?.note).toBe("US$");
  });

  it("searches codes, names and countries, the exact code first", () => {
    expect(menuSections("eur", "CAD", [])[0]?.items[0]?.info.code).toBe("EUR");
    expect(menuSections("japan", "CAD", [])[0]?.items.map((item) => item.info.code)).toContain("JPY");
    expect(menuSections("zzz", "CAD", [])).toEqual([]);
  });
});

describe("rates", () => {
  it("validates the contract's answer", () => {
    expect(exchangeRatesSchema.safeParse(answer()).success).toBe(true);
    expect(exchangeRatesSchema.safeParse(answer({ rates: { EUR: "1.4600" } })).success).toBe(false);
    expect(exchangeRatesSchema.safeParse(answer({ base: "XXX" })).success).toBe(false);
  });

  it("resolves a published, provisional, offline or missing rate", () => {
    expect(resolveRate("EUR", { answer: answer(), offline: false, failed: false, cached: null })).toEqual({
      state: "rate",
      rate: { rate: "1.4612", status: "published", rateDate: "2026-11-03", source: "European Central Bank", reason: null },
    });
    expect(resolveRate("EUR", { answer: answer({ date: "2026-11-09", rateDate: "2026-11-06", provisional: true }), offline: false, failed: false, cached: null })).toMatchObject({ state: "rate", rate: { status: "provisional", reason: "notYet" } });
    expect(resolveRate("EUR", { offline: true, failed: true, cached: answer({ rateDate: "2026-11-06" }) })).toMatchObject({ state: "rate", rate: { status: "provisional", rateDate: "2026-11-06", reason: "offline" } });
    expect(resolveRate("EUR", { offline: true, failed: true, cached: null })).toEqual({ state: "manual", reason: "unavailable" });
    expect(resolveRate("XAF", { answer: answer(), offline: false, failed: false, cached: null })).toEqual({ state: "manual", reason: "missing" });
    expect(resolveRate("EUR", { answer: answer({ enabled: false, source: null, rateDate: null, rates: {} }), offline: false, failed: false, cached: null })).toEqual({ state: "manual", reason: "off" });
    expect(resolveRate("EUR", { offline: false, failed: false, cached: null })).toEqual({ state: "loading" });
    // A server that fetches rates but has none yet: the person enters one.
    expect(resolveRate("EUR", { answer: answer({ rateDate: null, latestDate: null, rates: {} }), offline: false, failed: false, cached: null })).toEqual({ state: "manual", reason: "unavailable" });
  });

  it("keeps the latest answer per base for offline entries", () => {
    expect(lastKnownRates("CAD")).toBeNull();
    rememberRates(answer({ rateDate: "2026-11-06" }));
    rememberRates(answer({ rateDate: "2026-11-03", rates: { EUR: "1.4" } }));
    expect(lastKnownRates("CAD")?.rates.EUR).toBe("1.4612");
    rememberRates(answer({ enabled: false, source: null, rateDate: null, rates: {} }));
    expect(lastKnownRates("CAD")?.enabled).toBe(false);
    localStorage.setItem(RATES_STORAGE_KEY, "not json");
    expect(lastKnownRates("CAD")).toBeNull();
  });

  it("the demo serves the cards' sample rates, provisionally from today", () => {
    const today = new Date(2026, 10, 9);
    expect(demoRates("CAD", "2026-11-03", today)).toMatchObject({ rateDate: "2026-11-03", provisional: false, rates: { EUR: "1.4612" } });
    expect(demoRates("CAD", "2026-11-09", today)).toMatchObject({ rateDate: "2026-11-06", provisional: true, latestDate: "2026-11-06" });
    expect(demoRates("CAD", "2026-11-08", today).rateDate).toBe("2026-11-06");
  });
});

describe("drafts in another currency", () => {
  const base = (extra: Partial<EntryDraft> = {}): EntryDraft => ({ ...newDraft(ledger(), "expense", "2026-11-03"), title: "Cooking class", categoryId: "fun", amount: "85.00", currency: "EUR", ...extra });
  const published = { rate: "1.4612", status: "published" as const, rateDate: "2026-11-03" };

  it("saves the original amount, the rate and the converted home amounts", () => {
    expect(buildEntry(base(), ledger(), undefined, published).built?.transaction).toMatchObject({ total: 12420, share: 12420, originalAmount: 8500, originalCurrency: "EUR", rate: "1.4612", rateStatus: "published", rateDate: "2026-11-03" });
    const split = buildEntry(base({ split: "amount", shareInput: "20" }), ledger(), undefined, published).built?.transaction;
    expect(split).toMatchObject({ total: 12420, share: 2922 });
  });

  it("asks for a rate, keeps an edited one without a date, and never repeats", () => {
    expect(buildEntry(base(), ledger()).errors).toEqual({ rate: "Enter the exchange rate." });
    expect(buildEntry(base({ rateInput: "abc" }), ledger()).errors.rate).toBe("Enter a rate with up to eight decimal places.");
    const edited = buildEntry(base({ rateInput: "1,49", repeat: "monthly" }), ledger(), undefined, published).built;
    expect(edited?.transaction).toMatchObject({ total: 12665, rate: "1.49", rateStatus: "edited" });
    expect(edited?.transaction).not.toHaveProperty("rateDate");
    expect(edited?.rule).toBeUndefined();
    expect(buildEntry(base({ amount: "85.5", currency: "JPY" }), ledger(), undefined, published).errors.amount).toBe("Enter a whole amount, with no decimal places.");
  });

  it("restores an entry in another currency, keeping its rate until its date or currency changes", () => {
    const saved = tx("x", { total: 12420, share: 12420, originalAmount: 8500, originalCurrency: "EUR", rate: "1.4612", rateStatus: "published", rateDate: "2026-11-03" });
    const draft = draftFromEntry(saved);
    expect(draft).toMatchObject({ amount: "85.00", currency: "EUR", rateInput: null, storedRate: { currency: "EUR", date: "2026-11-03", rate: "1.4612", status: "published", rateDate: "2026-11-03" } });
    expect(buildEntry(draft, ledger([saved]), saved).built?.transaction).toEqual(saved);
    expect(buildEntry({ ...draft, date: "2026-11-04" }, ledger([saved]), saved).errors.rate).toBe("Enter the exchange rate.");
    const rest: Transaction = { ...saved };
    delete rest.rateDate;
    expect(draftFromEntry({ ...rest, rate: "1.49", rateStatus: "edited", total: 12665, share: 12665 })).toMatchObject({ rateInput: "1.49", storedRate: null });
  });
});

describe("provisional rates after a sync", () => {
  const provisional = tx("p", { date: "2026-11-09", total: 7022, share: 7022, originalAmount: 4800, originalCurrency: "EUR", rate: "1.463", rateStatus: "provisional", rateDate: "2026-11-06" });
  const edited = tx("e", { date: "2026-11-09", total: 7152, share: 7152, originalAmount: 4800, originalCurrency: "EUR", rate: "1.49", rateStatus: "edited" });

  it("lists the dates to ask for and replaces each entry with the published rate", () => {
    const book = ledger([provisional, edited, tx("home")]);
    expect(provisionalDates(book)).toEqual(["2026-11-09"]);
    const stillProvisional = new Map([["2026-11-09", answer({ date: "2026-11-09", rateDate: "2026-11-06", provisional: true, rates: { EUR: "1.463" } })]]);
    expect(settledEntries(book, stillProvisional)).toEqual([]);
    const out = new Map([["2026-11-09", answer({ date: "2026-11-09", rateDate: "2026-11-09", rates: { EUR: "1.47" } })]]);
    const settled = settledEntries(book, out);
    expect(settled).toEqual([{ ...provisional, total: 7056, share: 7056, rate: "1.47", rateStatus: "published", rateDate: "2026-11-09" }]);
    const next = settleChange(book.transactions, settled)(book);
    expect(next.transactions.find((item) => item.id === "p")?.rateStatus).toBe("published");
    expect(next.transactions.find((item) => item.id === "e")).toEqual(edited);
    // An edit in the meantime wins: the change leaves it alone.
    const changed = ledger([{ ...provisional, title: "Museum" }]);
    expect(settleChange(book.transactions, settled)(changed).transactions[0]?.title).toBe("Museum");
  });
});
