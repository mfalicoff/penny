import type { Kind, Ledger, Transaction } from "./ledger.ts";
import { isRecorded } from "./summary.ts";

export type EntryFilter = "all" | Kind;

// Local, durable offline/demo search: case-insensitive substring over title, note, category
// name and account name, trimmed. It deliberately does no accent folding (search v1 on the
// server folds text; see contracts/fixtures/search-cases.json `substringCases` vs `foldCases`).
// Like the server contract (docs/migration/search.md, "searchable document"), the fields are
// joined with single spaces and the query is matched against that whole document, so
// "beans morning" matches title "Coffee beans" with note "Morning".
export type SearchLookups = { categories: ReadonlyMap<string, string>; accounts: ReadonlyMap<string, string> };

export function searchLookups(ledger: Pick<Ledger, "categories" | "accounts">): SearchLookups {
  return {
    categories: new Map(ledger.categories.map((category) => [category.id, category.name])),
    accounts: new Map(ledger.accounts.map((account) => [account.id, account.name])),
  };
}

// The query is trimmed and lowercased once; use the returned predicate for every entry.
export function searchMatcher(query: string, lookups: SearchLookups): (entry: Transaction) => boolean {
  const needle = query.trim().toLowerCase();
  return (entry) =>
    `${entry.title} ${entry.note} ${lookups.categories.get(entry.categoryId) ?? ""} ${lookups.accounts.get(entry.accountId ?? "") ?? ""}`
      .toLowerCase().includes(needle);
}

// Newest first; equal dates order by id so results never depend on insertion order.
export const byDateDescThenId = (a: Transaction, b: Transaction) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id);

// Recorded entries only (scheduled occurrences are never history). Pending local edits,
// renames and deletions are visible because the input is the local ledger.
export function searchEntries(ledger: Ledger, query: string, options: { kind?: Kind; day?: string } = {}): Transaction[] {
  const matches = searchMatcher(query, searchLookups(ledger));
  return ledger.transactions
    .filter((entry) => isRecorded(entry) && (!options.kind || entry.kind === options.kind) && (!options.day || entry.date === options.day) && matches(entry))
    .sort(byDateDescThenId);
}
