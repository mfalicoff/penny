// @vitest-environment node
// Recurring suggestions (MAZ-290): accepting, dismissing and the ledger limits. The detection
// cases themselves are the golden fixture (recurring-suggestions.json, golden-fixtures.test.ts).
import { test } from "vitest";
import assert from "node:assert/strict";
import { acceptSuggestion, dismissSuggestion, undoDismissSuggestion } from "../../src/domain/commands.ts";
import { emptyLedger, materialize, type Ledger, type Transaction } from "../../src/domain/ledger.ts";
import { mergeLedger } from "../../src/domain/merge.ts";
import { MAX_DISMISSED_SUGGESTIONS, mergeDismissals, recurringSuggestions, suggestedRule, withDismissal } from "../../src/domain/suggestions.ts";
import { ledgerWriteSchema } from "../../src/validation/ledger.ts";

const netflix = (date: string, share: number): Transaction => ({
  id: `netflix-${date}`, title: "Netflix", kind: "expense", total: share, share, categoryId: "fun", date, note: "",
});
const book = (): Ledger => ({
  ...emptyLedger(),
  transactions: [netflix("2026-08-03", 1549), netflix("2026-09-03", 1549), netflix("2026-10-03", 1699), netflix("2026-11-03", 1699)],
});
const valid = (ledger: Ledger) => ledgerWriteSchema.safeParse({ revision: 0, ledger }).success;

test("accepting creates exactly one rule, records no date twice and changes no past entry", () => {
  for (const today of ["2026-11-03", "2026-11-20", "2026-12-02"]) {
    const ledger = book();
    const [suggestion] = recurringSuggestions(ledger, today);
    assert.ok(suggestion, today);
    const accepted = acceptSuggestion(suggestedRule(suggestion, "rule-1"))(ledger);
    assert.equal(accepted.recurring.length, 1);
    assert.deepEqual(accepted.transactions, ledger.transactions);
    assert.ok(valid(accepted));
    const caughtUp = materialize(accepted, today);
    assert.equal(caughtUp.transactions.length, ledger.transactions.length, `nothing recorded on ${today}`);
    // Later catch-up records the next dates only, never one already in the activity.
    const later = materialize(accepted, "2027-01-10");
    const dates = later.transactions.map((entry) => entry.date);
    assert.equal(new Set(dates).size, dates.length);
    assert.deepEqual(later.transactions.slice(4).map((entry) => entry.date), ["2026-12-03", "2027-01-03"]);
    // Once accepted, the group is covered: the suggestion is gone.
    assert.deepEqual(recurringSuggestions(accepted, today), []);
    // Accepting twice (a double tap) still saves one rule.
    assert.equal(acceptSuggestion(suggestedRule(suggestion, "rule-1"))(accepted).recurring.length, 1);
  }
});

test("accepting refuses a category or account removed on another device", () => {
  const [suggestion] = recurringSuggestions(book(), "2026-11-20");
  assert.ok(suggestion);
  assert.throws(() => acceptSuggestion({ ...suggestedRule(suggestion, "r"), categoryId: "gone" })(book()), /category was removed/);
  assert.throws(() => acceptSuggestion({ ...suggestedRule(suggestion, "r"), accountId: "gone" })(book()), /account was removed/);
});

test("dismiss hides the suggestion, Undo brings it back, and both stay valid ledgers", () => {
  const ledger = book();
  const [suggestion] = recurringSuggestions(ledger, "2026-11-20");
  assert.ok(suggestion);
  const dismissed = dismissSuggestion(suggestion)(ledger);
  assert.deepEqual(dismissed.dismissedSuggestions, ["expense|netflix|monthly|1699"]);
  assert.deepEqual(recurringSuggestions(dismissed, "2026-11-20"), []);
  assert.ok(valid(dismissed));
  const undone = undoDismissSuggestion(suggestion)(dismissed);
  assert.deepEqual(undone.dismissedSuggestions, []);
  assert.equal(recurringSuggestions(undone, "2026-11-20").length, 1);
  assert.ok(valid(undone));
  // Dismissing twice stores it once.
  assert.deepEqual(dismissSuggestion(suggestion)(dismissed).dismissedSuggestions, dismissed.dismissedSuggestions);
});

test("dismissals keep the newest 500, and the schema refuses more or duplicates", () => {
  let list: string[] = [];
  for (let index = 0; index < MAX_DISMISSED_SUGGESTIONS + 5; index += 1) list = withDismissal(list, `expense|item ${String(index)}|monthly|100`);
  assert.equal(list.length, MAX_DISMISSED_SUGGESTIONS);
  assert.equal(list[0], "expense|item 5|monthly|100");
  assert.ok(valid({ ...emptyLedger(), dismissedSuggestions: list }));
  assert.ok(!valid({ ...emptyLedger(), dismissedSuggestions: [...list, "one more"] }));
  assert.ok(!valid({ ...emptyLedger(), dismissedSuggestions: ["a", "a"] }));
  assert.ok(!valid({ ...emptyLedger(), dismissedSuggestions: [""] }));
  assert.ok(!valid({ ...emptyLedger(), dismissedSuggestions: ["x".repeat(201)] }));
});

test("dismissals merge offline as a set union, less what this device undid", () => {
  assert.deepEqual(mergeDismissals(["a"], ["a", "b"], ["a", "c"]), ["a", "c", "b"]);
  assert.deepEqual(mergeDismissals(["a"], [], ["a", "c"]), ["c"]);
  assert.deepEqual(mergeDismissals(undefined, undefined, undefined), undefined);
  assert.deepEqual(mergeDismissals(undefined, undefined, ["c"]), ["c"]);
  // Through the ledger merge: a ledger with none stays without the field.
  const ledger = book();
  assert.equal("dismissedSuggestions" in mergeLedger(ledger, ledger, ledger), false);
  const local = { ...ledger, dismissedSuggestions: ["expense|netflix|monthly|1699"] };
  assert.deepEqual(mergeLedger(ledger, local, ledger).dismissedSuggestions, ["expense|netflix|monthly|1699"]);
});

test("detection stays fast on a large ledger", () => {
  const transactions: Transaction[] = [];
  for (let index = 0; index < 50000; index += 1) {
    const day = String(1 + (index % 28)).padStart(2, "0");
    const month = String(1 + (Math.floor(index / 28) % 12)).padStart(2, "0");
    transactions.push({ id: `e${String(index)}`, title: `Shop ${String(index % 700)}`, kind: "expense", total: 1000 + (index % 97), share: 1000 + (index % 97), categoryId: "fun", date: `2026-${month}-${day}`, note: "" });
  }
  const started = performance.now();
  recurringSuggestions({ ...emptyLedger(), transactions }, "2026-11-20");
  assert.ok(performance.now() - started < 2000);
});
