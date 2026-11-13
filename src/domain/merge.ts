import type { Ledger, Recurring, Transaction } from "./ledger.ts";

// Three-way merge of an unsynced local ledger onto a newer server ledger (offline sync).
// Golden cases: contracts/fixtures/merge-conflicts.json. The native app (`LedgerMerge.swift`)
// and the browser (`apps/web/src/offline/merge.ts`) run the same rules, so all three agree.
//
// Per list, by id: a record this device did not change follows the server; a record changed on
// both sides keeps every remote field this device did not edit (same-field races: local wins); a
// record this device deleted is removed; a record this device edited that the server deleted comes
// back; records created here are appended after the server's. Currency: a local change wins.
//
// Four personal-recurrence refinements keep a rule this device only caught up offline from undoing
// what another device did (docs/ios-offline-sync.md). An occurrence is "untouched" when it equals
// what its rule generates for its date:
//
// - When both sides advanced a rule's `nextDate`, the later one wins, so dates the server already
//   consumed are never recorded again.
// - An occurrence both sides recorded takes the server's copy when this device's is untouched, so an
//   edit made on the other device is kept.
// - An untouched occurrence only this device recorded is dropped when the server's rule is already
//   past its date and the server doesn't have it: another device recorded it and deleted it.
// - A rule the server deleted stays deleted when this device only caught it up (moved `nextDate`),
//   and the untouched occurrences recorded here for it go with it. A rule edited here in any other
//   field comes back, as any edited record does.
//
// Pure; callers materialize after.
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
  // An occurrence both sides recorded is the same record: the server's copy wins over this device's untouched one.
  const remoteEntries = new Map(remote.transactions.map((entry) => [entry.id, entry]));
  const baseIds = new Set(base.transactions.map((entry) => entry.id));
  const localEntries = local.transactions.map((entry) => {
    const theirs = remoteEntries.get(entry.id);
    if (baseIds.has(entry.id) || !theirs || untouchedOccurrenceDate(entry, base, local) === null) return entry;
    return theirs;
  });
  const recurring = keepConsumedDates(
    mergeItems(base.recurring, withoutCatchUpOfDeletedRules(base, local, remote), remote.recurring), base, local, remote);
  const ruleIds = new Set(recurring.map((rule) => rule.id));
  return {
    ...remote,
    currency: local.currency !== base.currency ? local.currency : remote.currency,
    accounts: mergeItems(base.accounts, local.accounts, remote.accounts),
    trips: mergeItems(base.trips, local.trips, remote.trips),
    categories: mergeItems(base.categories, local.categories, remote.categories),
    transactions: dropConsumedOccurrences(mergeItems(base.transactions, localEntries, remote.transactions), base, local, remote, ruleIds),
    recurring,
  };
}

/** Key-order-insensitive JSON, without `undefined` fields: how two records are compared for "untouched". */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return item;
    const record = item as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
  });
}

const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const ruleOf = (ledger: Ledger, id: string) => ledger.recurring.find((rule) => rule.id === id);

/** What `materialize` records for `rule` on `date` (src/domain/ledger.ts). */
export function occurrenceOf(rule: Recurring, date: string): Transaction {
  return {
    id: `${rule.id}:${date}`,
    title: rule.title,
    kind: rule.kind,
    total: rule.total,
    share: rule.share,
    categoryId: rule.categoryId,
    accountId: rule.accountId,
    date,
    note: rule.note,
    recurringId: rule.id,
  };
}

/** The occurrence date when `entry` is exactly what its rule (stored locally or in the base) generates for it; otherwise null. */
export function untouchedOccurrenceDate(entry: Transaction, base: Ledger, local: Ledger): string | null {
  const ruleId = entry.recurringId;
  if (!ruleId || !entry.id.startsWith(`${ruleId}:`)) return null;
  const date = entry.id.slice(ruleId.length + 1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const generators = [ruleOf(local, ruleId), ruleOf(base, ruleId)].filter((rule): rule is Recurring => rule !== undefined);
  return generators.some((rule) => same(occurrenceOf(rule, date), entry)) ? date : null;
}

/**
 * `local.recurring` with each rule the server deleted put back to its base copy when this device
 * only caught it up, so the merge sees it as unchanged and follows the delete.
 */
function withoutCatchUpOfDeletedRules(base: Ledger, local: Ledger, remote: Ledger): Recurring[] {
  return local.recurring.map((rule) => {
    const before = ruleOf(base, rule.id);
    if (ruleOf(remote, rule.id) || !before) return rule;
    return same({ ...before, nextDate: rule.nextDate }, rule) ? before : rule;
  });
}

/** When both sides advanced a rule past the base `nextDate`, keep the later one. */
function keepConsumedDates(merged: Recurring[], base: Ledger, local: Ledger, remote: Ledger): Recurring[] {
  return merged.map((rule) => {
    const before = ruleOf(base, rule.id);
    const mine = ruleOf(local, rule.id);
    const theirs = ruleOf(remote, rule.id);
    if (!before || !mine || !theirs || mine.nextDate <= before.nextDate || theirs.nextDate <= before.nextDate) return rule;
    const nextDate = mine.nextDate > theirs.nextDate ? mine.nextDate : theirs.nextDate;
    return nextDate === rule.nextDate ? rule : { ...rule, nextDate };
  });
}

/** Drops untouched occurrences recorded only here that the server consumed and removed, or whose deleted rule isn't coming back. */
function dropConsumedOccurrences(merged: Transaction[], base: Ledger, local: Ledger, remote: Ledger, ruleIds: Set<string>): Transaction[] {
  const baseIds = new Set(base.transactions.map((entry) => entry.id));
  const remoteIds = new Set(remote.transactions.map((entry) => entry.id));
  return merged.filter((entry) => {
    if (baseIds.has(entry.id) || remoteIds.has(entry.id) || !entry.recurringId) return true;
    const date = untouchedOccurrenceDate(entry, base, local);
    if (date === null) return true;
    const serverRule = ruleOf(remote, entry.recurringId);
    if (!serverRule) return !ruleOf(base, entry.recurringId) || ruleIds.has(entry.recurringId);
    return serverRule.nextDate <= date;
  });
}
