import { test } from "node:test";
import assert from "node:assert/strict";
import { saveEntry, saveTrip } from "../src/domain/commands.ts";
import { emptyLedger, upgradeLedger, type Transaction, type Trip } from "../src/domain/ledger.ts";
import { buildEntry, type EntryDraft } from "../src/features/entries/entryDraft.ts";
import { tripOverview } from "../src/features/trips/selectors.ts";
import { ledgerWriteSchema } from "../server/validation/ledger.ts";

const trip: Trip = { id: "montreal", name: "Montréal", startDate: "2026-09-10", endDate: "2026-09-14" };
const draft: EntryDraft = { title: "Train", kind: "expense", amount: "120.00", date: "2026-08-01", categoryId: "transport", tripId: trip.id, note: "", split: "equal", shareInput: "2", frequency: "monthly" };

test("legacy ledgers gain an empty trip list and keep existing expenses", () => {
  const current = emptyLedger();
  const legacy = { ...current, version: 3 as const, trips: undefined };
  const upgraded = upgradeLedger(legacy);
  assert.equal(upgraded.version, 4);
  assert.deepEqual(upgraded.trips, []);
  assert.deepEqual(upgradeLedger(upgraded), upgraded);
  assert.deepEqual(ledgerWriteSchema.parse({ revision: 0, ledger: legacy }).ledger, upgraded);
});

test("trip assignments count the personal share and do not repeat with a schedule", () => {
  const ledger = saveTrip(trip)(emptyLedger());
  const { transaction, recurring } = buildEntry(draft, ledger.categories);
  assert.equal(transaction.tripId, trip.id);
  assert.equal(recurring && "tripId" in recurring, false);
  const saved = saveEntry(transaction, undefined, recurring)(ledger);
  const overview = tripOverview(saved, trip);
  assert.equal(overview.total, 6000);
  assert.equal(overview.receiptTotal, 12000);
  assert.deepEqual(overview.categories.map((category) => [category.id, category.amount]), [["transport", 6000]]);
  assert.equal(ledgerWriteSchema.safeParse({ revision: 0, ledger: saved }).success, true);
  assert.equal(buildEntry({ ...draft, kind: "income", categoryId: "salary" }, ledger.categories).transaction.tripId, undefined);
});

test("trip edits are protected and trips with expenses cannot be deleted", () => {
  const ledger = saveTrip(trip)(emptyLedger());
  const transaction: Transaction = buildEntry({ ...draft, frequency: "none" }, ledger.categories).transaction;
  const used = saveEntry(transaction)(ledger);
  assert.throws(() => saveTrip(trip, trip, true)(used), /Reassign/);
  assert.throws(() => saveEntry({ ...transaction, tripId: "missing" })(ledger), /Choose another trip/);
  assert.throws(() => saveTrip({ ...trip, endDate: "2026-09-01" })(ledger), /trip dates/);
  assert.throws(() => saveTrip({ ...trip, id: "other", name: " MONTRÉAL " })(ledger), /already have/);
  const renamed = saveTrip({ ...trip, name: "Fall escape" }, trip)(ledger);
  assert.throws(() => saveTrip(trip, trip)(renamed), /changed on another device/);
  assert.equal(saveTrip(trip, trip, true)(ledger).trips.length, 0);
});

test("server rejects missing trips, invalid trip references, and non-expense assignments", () => {
  const ledger = saveTrip(trip)(emptyLedger());
  const expense = buildEntry({ ...draft, frequency: "none" }, ledger.categories).transaction;
  const validate = (candidate: unknown) => ledgerWriteSchema.safeParse({ revision: 0, ledger: candidate }).success;
  assert.equal(validate({ ...ledger, trips: undefined }), false);
  assert.equal(validate({ ...ledger, trips: [{ ...trip, endDate: "2026-09-01" }] }), false);
  assert.equal(validate({ ...ledger, transactions: [{ ...expense, tripId: "missing" }] }), false);
  assert.equal(validate({ ...ledger, transactions: [{ ...expense, kind: "income", categoryId: "salary" }] }), false);
});
