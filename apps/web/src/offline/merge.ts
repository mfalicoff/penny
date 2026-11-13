/**
 * The browser's three-way merge is the shared `mergeLedger` (`src/domain/merge.ts`, golden cases in
 * `contracts/fixtures/merge-conflicts.json`), which carries the native app's four personal-recurrence
 * refinements (`LedgerMerge.swift`, docs/ios-offline-sync.md). Pure; callers materialize after.
 */
export { mergeLedger as mergeOfflineLedger, occurrenceOf, untouchedOccurrenceDate } from "@domain/merge.ts";
