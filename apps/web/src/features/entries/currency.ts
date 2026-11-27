import { currencies, currencyInfo, minorUnits, type CurrencyInfo, type RateStatus } from "@domain/currency.ts";
import type { Ledger, Transaction } from "@domain/ledger.ts";
import { formatCents } from "../../design/Money";
import type { ExchangeRates } from "../../api/schemas";

/**
 * How the web shows entries in several currencies (MAZ-151 phase 1, cards `web-add-entry-currency`,
 * `web-entry-rate-*`, `web-activity-currencies`, `web-currency-rates*`, `iphone-home-currencies`).
 * Every calculation is the shared rule's (`@domain/currency.ts`); this file only words and formats.
 */

const MINUS = "−";

function symbolOf(code: string, locale: string, display: "narrowSymbol" | "symbol"): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: code, currencyDisplay: display }).formatToParts(0).find((part) => part.type === "currency")?.value ?? code;
  } catch {
    return code;
  }
}

/**
 * The symbol an amount in `code` is written with beside home amounts in `home`: its own narrow
 * symbol ("€", "¥"), unless that is the home currency's ("$"), then its prefixed one ("US$" when
 * home is CAD, "CA$" when home is USD), else its code.
 */
export function currencySymbolFor(code: string, home?: string): string {
  const narrow = symbolOf(code, "en-CA", "narrowSymbol");
  if (!home || code === home) return narrow;
  const homeNarrow = symbolOf(home, "en-CA", "narrowSymbol");
  if (narrow !== homeNarrow) return narrow;
  for (const locale of ["en-CA", "en-US"]) {
    const symbol = symbolOf(code, locale, "symbol");
    if (symbol !== homeNarrow && symbol !== symbolOf(home, locale, "symbol")) return symbol;
  }
  return code;
}

/**
 * An amount in `code`'s minor units ("€85.00", "¥1,200", "KWD 1.250"), with the symbol
 * `currencySymbolFor` picks. Home amounts keep `formatCents`.
 */
export function formatMinor(amount: number, code: string, home?: string, options: { signed?: boolean } = {}): string {
  if (code === home) return formatCents(amount, code, options);
  const units = currencyInfo(code)?.minorUnits ?? 2;
  let format: Intl.NumberFormat;
  try {
    format = new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: units,
      maximumFractionDigits: units,
      ...(options.signed ? { signDisplay: "exceptZero" as const } : {}),
    });
  } catch {
    return `${code} ${(amount / 10 ** units).toFixed(units)}`;
  }
  const symbol = currencySymbolFor(code, home);
  return format
    .formatToParts(amount / 10 ** units)
    .map((part) => (part.type === "currency" ? symbol : part.type === "minusSign" ? MINUS : part.value))
    .join("");
}

/** A rate as the cards write it: at least four decimals ("1.46" reads "1.4600", "1.4612" stays). */
export function displayRate(rate: string): string {
  const [whole = "0", fraction = ""] = rate.split(".");
  return `${whole}.${fraction.padEnd(4, "0")}`;
}

/** "1 EUR = 1.4612 CAD". */
export function rateLine(code: string, rate: string, home: string): string {
  return `1 ${code} = ${displayRate(rate)} ${home}`;
}

const utc = (date: string) => {
  const [year = 2000, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

/** "Nov 3". */
export function shortDate(date: string): string {
  return utc(date).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "Fri, Nov 6". */
export function weekdayDate(date: string): string {
  return utc(date).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** "Friday". */
export function weekdayName(date: string): string {
  return utc(date).toLocaleDateString("en-CA", { weekday: "long", timeZone: "UTC" });
}

/** "Used once", "Used twice", "Used 3 times". */
export function usedText(count: number): string {
  return count === 1 ? "Used once" : count === 2 ? "Used twice" : `Used ${String(count)} times`;
}

export interface CurrencyUse {
  code: string;
  count: number;
  /** The rate of the latest entry in this currency (by date, then ledger order). */
  lastRate: string;
  lastDate: string;
}

/**
 * The currencies other than home that entries were paid in, the most recently used first
 * (Settings › Recent currencies, the menu's Recent, and the suggested rate when rates are off).
 */
export function currencyUses(ledger: Pick<Ledger, "transactions">): CurrencyUse[] {
  const uses = new Map<string, CurrencyUse>();
  for (const entry of ledger.transactions) {
    if (!entry.originalCurrency || !entry.rate) continue;
    const use = uses.get(entry.originalCurrency);
    if (!use) uses.set(entry.originalCurrency, { code: entry.originalCurrency, count: 1, lastRate: entry.rate, lastDate: entry.date });
    else {
      use.count += 1;
      if (entry.date >= use.lastDate) {
        use.lastRate = entry.rate;
        use.lastDate = entry.date;
      }
    }
  }
  return [...uses.values()].sort((a, b) => b.lastDate.localeCompare(a.lastDate) || b.count - a.count || a.code.localeCompare(b.code));
}

/** The last rate used for `code` (rates off: "use your last one (1.4600)"), or null. */
export function lastRateFor(ledger: Pick<Ledger, "transactions">, code: string): string | null {
  return currencyUses(ledger).find((use) => use.code === code)?.lastRate ?? null;
}

/**
 * Keeps what was typed when the currency changes, dropping digits beyond the new currency's minor
 * units at once (`docs/design/motion.md`: JPY has none).
 */
export function fitAmount(amount: string, code: string): string {
  const units = minorUnits(code);
  const match = /^(\d*)([.,])(\d*)$/.exec(amount.trim());
  if (!match) return amount;
  if (units === 0) return match[1] ?? "";
  return `${match[1] ?? ""}${match[2] ?? "."}${(match[3] ?? "").slice(0, units)}`;
}

export interface MenuSection {
  title: string;
  items: { info: CurrencyInfo; note: string | null }[];
}

const matches = (info: CurrencyInfo, needle: string) =>
  info.code.toLowerCase().includes(needle) || info.name.toLowerCase().includes(needle) || info.countries.toLowerCase().includes(needle);

/** What a currency's row says on the right: "Home", its symbol when another shares the home one ("US$"), or "No decimals". */
function noteOf(info: CurrencyInfo, home: string): string | null {
  if (info.code === home) return "Home";
  if (info.minorUnits === 0) return "No decimals";
  const symbol = currencySymbolFor(info.code, home);
  return symbol !== symbolOf(info.code, "en-CA", "narrowSymbol") ? symbol : null;
}

/**
 * The currency menu (`web-add-entry-currency`): Suggested (the home currency; a trip's currency is
 * phase 2), Recent (the last used), then every currency A–Z. A search lists the matches by code,
 * name or country, in one section.
 */
export function menuSections(query: string, home: string, recent: readonly string[]): MenuSection[] {
  const needle = query.trim().toLowerCase();
  const item = (info: CurrencyInfo) => ({ info, note: noteOf(info, home) });
  if (needle) {
    // An exact code first, then codes and names that start with it, then the rest A–Z.
    const rank = (info: CurrencyInfo) => (info.code.toLowerCase() === needle ? 0 : info.code.toLowerCase().startsWith(needle) || info.name.toLowerCase().startsWith(needle) ? 1 : 2);
    const found = currencies.filter((info) => matches(info, needle)).sort((a, b) => rank(a) - rank(b));
    return found.length ? [{ title: "Matches", items: found.map(item) }] : [];
  }
  const homeInfo = currencyInfo(home);
  const recentInfo = recent.filter((code) => code !== home).flatMap((code) => currencyInfo(code) ?? []).slice(0, 4);
  return [
    ...(homeInfo ? [{ title: "Suggested", items: [item(homeInfo)] }] : []),
    ...(recentInfo.length ? [{ title: "Recent", items: recentInfo.map(item) }] : []),
    { title: "All currencies", items: currencies.map(item) },
  ];
}

/** The rate a draft in another currency will be saved with, from the server's answer or this browser's last one. */
export type AutoRate = {
  rate: string;
  status: Exclude<RateStatus, "edited">;
  rateDate: string;
  /** Who published it ("European Central Bank"); null when unknown (an entry's own stored rate). */
  source: string | null;
  /** Why it's provisional: the date's rate isn't out yet, or Penny is offline and used its last one. */
  reason: "notYet" | "offline" | null;
};

/** No rate to use: the server doesn't fetch rates, doesn't quote this currency, or couldn't be asked. */
export type ManualReason = "off" | "missing" | "unavailable";

export type RateLookup = { state: "loading" } | { state: "rate"; rate: AutoRate } | { state: "manual"; reason: ManualReason };

/**
 * The rate for `code` from the server's answer for the entry's date; offline, from the last answer
 * this browser kept (provisional, replaced on the next sync).
 */
export function resolveRate(
  code: string,
  lookup: { answer?: ExchangeRates | undefined; offline: boolean; failed: boolean; cached: ExchangeRates | null },
): RateLookup {
  const { answer, offline, failed, cached } = lookup;
  if (answer) {
    if (!answer.enabled) return { state: "manual", reason: "off" };
    // Fetching on but nothing fetched yet (an empty cache): ask for a rate, as for a currency with none.
    if (!answer.rateDate) return { state: "manual", reason: "unavailable" };
    const rate = answer.rates[code];
    if (!rate) return { state: "manual", reason: "missing" };
    return { state: "rate", rate: { rate, status: answer.provisional ? "provisional" : "published", rateDate: answer.rateDate, source: answer.source, reason: answer.provisional ? "notYet" : null } };
  }
  if (offline) {
    if (cached && !cached.enabled) return { state: "manual", reason: "off" };
    const rate = cached?.rates[code];
    if (cached && rate && cached.rateDate) return { state: "rate", rate: { rate, status: "provisional", rateDate: cached.rateDate, source: cached.source, reason: "offline" } };
    return { state: "manual", reason: cached ? "missing" : "unavailable" };
  }
  if (failed) return { state: "manual", reason: "unavailable" };
  return { state: "loading" };
}

/** The entry's original amount and rate, when it was paid in another currency. */
export function foreignOf(entry: Pick<Transaction, "originalAmount" | "originalCurrency" | "rate" | "rateStatus" | "rateDate">) {
  if (entry.originalAmount === undefined || !entry.originalCurrency || !entry.rate || !entry.rateStatus) return null;
  return { amount: entry.originalAmount, currency: entry.originalCurrency, rate: entry.rate, status: entry.rateStatus, rateDate: entry.rateDate };
}
