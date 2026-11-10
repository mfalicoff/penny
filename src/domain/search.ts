import type { Ledger, Transaction } from "./ledger.ts";

// Local, durable offline/demo search: case-insensitive substring over title, note, category
// name and account name. It deliberately does no accent folding (search v1 on the server
// folds text; see contracts/fixtures/search-cases.json `substringCases` vs `foldCases`).
export type SearchLookups = { categories: ReadonlyMap<string, string>; accounts: ReadonlyMap<string, string> };

export function searchLookups(ledger: Pick<Ledger, "categories" | "accounts">): SearchLookups {
  return {
    categories: new Map(ledger.categories.map((category) => [category.id, category.name])),
    accounts: new Map(ledger.accounts.map((account) => [account.id, account.name])),
  };
}

export function matchesSearch(entry: Transaction, query: string, lookups: SearchLookups): boolean {
  const haystack = `${entry.title} ${entry.note} ${lookups.categories.get(entry.categoryId) ?? ""} ${lookups.accounts.get(entry.accountId ?? "") ?? ""}`;
  return haystack.toLowerCase().includes(query.toLowerCase());
}

// Newest first; equal dates order by id so results never depend on insertion order.
export const byDateDescThenId = (a: Transaction, b: Transaction) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id);

// Recorded entries only: scheduled previews are never searchable history. Pending local
// edits, renames and deletions are visible because the input is the local ledger.
export function searchEntries(ledger: Ledger, query: string, options: { kind?: Transaction["kind"]; day?: string } = {}): Transaction[] {
  const lookups = searchLookups(ledger);
  const needle = query.trim();
  return ledger.transactions
    .filter((entry) => (!options.kind || entry.kind === options.kind) && (!options.day || entry.date === options.day) && matchesSearch(entry, needle, lookups))
    .sort(byDateDescThenId);
}
