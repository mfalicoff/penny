import type { Ledger } from "./ledger.ts";

// Three-way merge of an unsynced local ledger onto a newer server ledger (offline sync).
// Golden cases: contracts/fixtures/merge-conflicts.json.
type Item = { id: string };

function mergeItems<T extends Item>(base: T[], local: T[], remote: T[]): T[] {
  const before = new Map(base.map((item) => [item.id, item]));
  const changed = new Map(local.filter((item) => JSON.stringify(item) !== JSON.stringify(before.get(item.id)))
    .map((item) => [item.id, item]));
  const removed = new Set(base.filter((item) => !local.some((next) => next.id === item.id)).map((item) => item.id));
  const remoteIds = new Set(remote.map((item) => item.id));
  const result = remote.filter((item) => !removed.has(item.id)).map((item) => {
    const next = changed.get(item.id);
    if (!next) return item;
    const original = before.get(item.id);
    if (!original) return next;
    // Keep remote fields this device did not edit.
    const merged = { ...item } as Record<string, unknown>;
    for (const key of new Set([...Object.keys(original), ...Object.keys(next)])) {
      if (JSON.stringify(next[key as keyof T]) !== JSON.stringify(original[key as keyof T]))
        merged[key] = next[key as keyof T];
    }
    return merged as T;
  });
  for (const item of local) if (!remoteIds.has(item.id) && changed.has(item.id)) result.push(item);
  return result;
}

export function mergeLedger(base: Ledger, local: Ledger, remote: Ledger): Ledger {
  return {
    ...remote,
    currency: local.currency !== base.currency ? local.currency : remote.currency,
    accounts: mergeItems(base.accounts, local.accounts, remote.accounts),
    trips: mergeItems(base.trips, local.trips, remote.trips),
    categories: mergeItems(base.categories, local.categories, remote.categories),
    transactions: mergeItems(base.transactions, local.transactions, remote.transactions),
    recurring: mergeItems(base.recurring, local.recurring, remote.recurring),
  };
}
