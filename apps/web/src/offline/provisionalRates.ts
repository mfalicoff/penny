import type { LedgerChange } from "@domain/commands.ts";
import { reconvertEntry } from "@domain/currency.ts";
import type { Ledger, Transaction } from "@domain/ledger.ts";
import type { ExchangeRates } from "../api/schemas";

/**
 * Provisional rates made final (MAZ-151). An entry dated after the latest publication, or made
 * offline, carries the latest known rate as `provisional`. After a sync, Penny asks the server for
 * each such entry's date again; once the date's rate is published (or a later provisional one is
 * known) the entry is converted again with the shared `reconvertEntry` and saved through the
 * offline store like any edit, so it syncs, merges and reaches other devices as one. Edited rates
 * are never touched.
 */

/** The distinct dates of the ledger's provisional entries. */
export function provisionalDates(ledger: Pick<Ledger, "transactions">): string[] {
  return [...new Set(ledger.transactions.filter((entry) => entry.originalCurrency && entry.rateStatus === "provisional").map((entry) => entry.date))].sort();
}

/**
 * The provisional entries that `answers` (the server's rates per date) now give a better rate:
 * the date's published rate, or a later provisional one. Entries whose answer is missing, off or
 * unchanged are left out.
 */
export function settledEntries(ledger: Pick<Ledger, "transactions" | "currency">, answers: ReadonlyMap<string, ExchangeRates>): Transaction[] {
  const settled: Transaction[] = [];
  for (const entry of ledger.transactions) {
    if (!entry.originalCurrency || entry.rateStatus !== "provisional") continue;
    const answer = answers.get(entry.date);
    if (!answer?.enabled || !answer.rateDate || answer.base !== ledger.currency) continue;
    const rate = answer.rates[entry.originalCurrency];
    if (!rate) continue;
    const status = answer.provisional ? "provisional" : "published";
    if (status === "provisional" && rate === entry.rate && answer.rateDate === entry.rateDate) continue;
    settled.push(reconvertEntry(entry, ledger.currency, { rate, rateStatus: status, rateDate: answer.rateDate }));
  }
  return settled;
}

/**
 * The change that replaces each provisional entry with its settled version, only where the stored
 * entry is still the one the rate was looked up for (an edit meanwhile wins).
 */
export function settleChange(before: readonly Transaction[], after: readonly Transaction[]): LedgerChange {
  const original = new Map(before.map((entry) => [entry.id, JSON.stringify(entry)]));
  const next = new Map(after.map((entry) => [entry.id, entry]));
  return (ledger) => ({
    ...ledger,
    transactions: ledger.transactions.map((entry) => {
      const settled = next.get(entry.id);
      return settled && original.get(entry.id) === JSON.stringify(entry) ? settled : entry;
    }),
  });
}
