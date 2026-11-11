import type { Ledger, Recurring, Transaction } from "@domain/ledger.ts";
import { mergeLedger } from "@domain/merge.ts";

/**
 * The browser's three-way merge: the shared `mergeLedger` (`src/domain/merge.ts`, golden cases in
 * `contracts/fixtures/merge-conflicts.json`) plus the native app's four personal-recurrence
 * refinements (`LedgerMerge.swift`, docs/ios-offline-sync.md), so a rule this browser only caught
 * up offline can't undo what another device did:
 *
 * - When both sides advanced a rule's `nextDate`, the later one wins, so dates the server already
 *   consumed are never recorded again.
 * - An occurrence both sides recorded takes the server's copy when this browser's is untouched
 *   (exactly what its rule generates), so an edit made on the other device is kept.
 * - An untouched occurrence only this browser recorded is dropped when the server's rule is already
 *   past its date and the server doesn't have it: another device recorded it and deleted it.
 * - A rule the server deleted stays deleted when this browser only caught it up (moved `nextDate`),
 *   and the untouched occurrences recorded here for it go with it. A rule edited here in any other
 *   field comes back, as any edited record does.
 *
 * The shared module is left unchanged for the legacy Expo app. Pure; callers materialize after.
 */
export function mergeOfflineLedger(base: Ledger, local: Ledger, remote: Ledger): Ledger {
  const remoteEntries = new Map(remote.transactions.map((entry) => [entry.id, entry]));
  const baseIds = new Set(base.transactions.map((entry) => entry.id));
  const localEntries = local.transactions.map((entry) => {
    const theirs = remoteEntries.get(entry.id);
    if (baseIds.has(entry.id) || !theirs || untouchedOccurrenceDate(entry, base, local) === null) return entry;
    return theirs;
  });
  const merged = mergeLedger(base, { ...local, recurring: withoutCatchUpOfDeletedRules(base, local, remote), transactions: localEntries }, remote);
  const recurring = keepConsumedDates(merged.recurring, base, local, remote);
  const ruleIds = new Set(recurring.map((rule) => rule.id));
  return { ...merged, recurring, transactions: dropConsumedOccurrences(merged.transactions, base, local, remote, ruleIds) };
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
 * `local.recurring` with each rule the server deleted put back to its base copy when this browser
 * only caught it up, so the shared merge sees it as unchanged and follows the delete.
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
