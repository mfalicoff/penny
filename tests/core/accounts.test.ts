import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyLedger, materialize, type PaymentAccount } from "../../src/domain/ledger.ts";
import { saveAccount, saveEntry, saveSchedule } from "../../src/domain/commands.ts";
import { buildEntry, buildSchedule, type EntryDraft } from "../../src/domain/entryDraft.ts";
import { selectOverview, scheduledEntries } from "../../src/domain/selectors/overview.ts";
import { ledgerWriteSchema } from "../../src/validation/ledger.ts";

const card: PaymentAccount = { id: "visa", name: "Visa", type: "credit" };
const cash: PaymentAccount = { id: "cash", name: "Wallet", type: "cash" };
const draft: EntryDraft = { title: "Groceries", kind: "expense", amount: "60", date: "2026-01-01", categoryId: "food", accountId: card.id, note: "", split: "equal", shareInput: "2", frequency: "monthly" };

function fixture() {
  const ledger = saveAccount(cash)(saveAccount(card)(emptyLedger()));
  const { transaction, recurring } = buildEntry(draft, ledger.categories);
  return { ledger: saveEntry(transaction, undefined, recurring)(ledger), transaction, recurring: recurring! };
}

test("a ledger write is version 4 with an accounts list", () => {
  const { accounts: _, ...withoutAccounts } = emptyLedger();
  assert.equal(ledgerWriteSchema.safeParse({ revision: 0, ledger: emptyLedger() }).success, true);
  assert.equal(ledgerWriteSchema.safeParse({ revision: 0, ledger: withoutAccounts }).success, false);
  for (const version of [1, 2, 3, 5])
    assert.equal(ledgerWriteSchema.safeParse({ revision: 0, ledger: { ...emptyLedger(), version } }).success, false, String(version));
});

test("accounts link to recurring previews and materialized entries and can be searched", () => {
  const { ledger } = fixture();
  assert.equal(ledger.transactions[0].share, 3000);
  assert.equal(scheduledEntries(ledger, "2026-02")[0].accountId, card.id);
  const due = materialize(ledger, "2026-03-01");
  assert.equal(due.transactions.length, 3);
  assert.ok(due.transactions.every((t) => t.accountId === card.id));
  assert.deepEqual(materialize(due, "2026-03-01"), due);
  const overview = selectOverview(due, { month: "2026-02", day: null, filter: "all", categoryId: null, search: "visa", today: "2026-02-28" });
  assert.equal(overview.visibleEntries.length, 1);
  assert.equal(overview.summary.expense, 3000);
});

test("reassigning or unlinking an entry and schedule preserves historical occurrences", () => {
  const { ledger, transaction, recurring } = fixture();
  const edited = buildEntry({ ...draft, accountId: cash.id }, ledger.categories, transaction).transaction;
  const saved = saveEntry(edited, transaction)(ledger);
  const nextRule = buildSchedule({ ...draft, accountId: cash.id, date: recurring.nextDate }, ledger.categories, recurring);
  const scheduled = saveSchedule(nextRule, recurring)(saved);
  assert.equal(materialize(scheduled, recurring.nextDate).transactions[1].accountId, cash.id);
  assert.equal(ledger.transactions[0].accountId, card.id);
  const unlinked = buildEntry({ ...draft, accountId: undefined }, ledger.categories, edited).transaction;
  assert.equal(saveEntry(unlinked, edited)(saved).transactions[0].accountId, undefined);
});

test("account commands reject duplicates, invalid names, stale edits and linked deletion", () => {
  const { ledger, transaction, recurring } = fixture();
  assert.throws(() => saveAccount({ ...cash, id: "duplicate", name: " VISA " })(ledger), /already have/);
  assert.throws(() => saveAccount({ ...cash, name: " " })(ledger), /name/);
  assert.throws(() => saveAccount(card, { ...card, name: "Old name" })(ledger), /changed on another device/);
  assert.throws(() => saveAccount(card, card, true)(ledger), /entries or schedules/);
  assert.throws(() => saveAccount(card, card, true)({ ...ledger, transactions: [] }), /entries or schedules/);
  assert.throws(() => saveEntry({ ...transaction, accountId: "missing" })(ledger), /removed on another device/);
  assert.throws(() => saveSchedule({ ...recurring, accountId: "missing" }, recurring)(ledger), /removed on another device/);
  const renamed = saveAccount({ ...card, name: "Travel Visa" }, card)(ledger);
  assert.equal(renamed.transactions[0].accountId, card.id);
  assert.equal(saveAccount(cash, cash, true)(ledger).accounts.length, 1);
});

test("ledger validation rejects dangling references, duplicate IDs, unknown types and missing v3 accounts", () => {
  const { ledger } = fixture();
  assert.equal(ledgerWriteSchema.safeParse({ revision: 0, ledger }).success, true);
  for (const collection of ["transactions", "recurring"] as const) {
    const broken = { ...ledger, [collection]: [{ ...ledger[collection][0], accountId: "missing" }] };
    assert.equal(ledgerWriteSchema.safeParse({ revision: 0, ledger: broken }).success, false);
  }
  for (const accounts of [[card, card], [{ ...card, type: "unknown" }], undefined])
    assert.equal(ledgerWriteSchema.safeParse({ revision: 0, ledger: { ...ledger, accounts } }).success, false);
});
