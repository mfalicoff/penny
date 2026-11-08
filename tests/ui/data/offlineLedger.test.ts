import { emptyLedger, type Transaction } from "../../../src/domain/ledger";
import { mergeLedger } from "../../../src/data/offlineLedger";
import parity from "../../../contracts/fixtures/parity-cases.json";

test("language-neutral conflict fixture preserves remote fields and local same-field edits", () => {
  const original: Transaction = { id: "synthetic-entry", title: "Sample", kind: "expense", total: 1000,
    categoryId: "food", date: "2026-10-01", ...parity.merge.base };
  const base = { ...emptyLedger(), transactions: [original] };
  const local = { ...base, transactions: [{ ...original, ...parity.merge.local }] };
  const remote = { ...base, transactions: [{ ...original, ...parity.merge.remote }] };
  const result = mergeLedger(base, local, remote).transactions[0];
  expect({ note: result.note, share: result.share }).toEqual(parity.merge.expected);
  const raced = { ...base, transactions: [{ ...remote.transactions[0], note: "Remote edit" }] };
  expect(mergeLedger(base, local, raced).transactions[0].note).toBe(parity.merge.local.note);
});

test("reconnect merges independent device edits without dropping remote additions", () => {
  const original: Transaction = {
    id: "one", title: "Coffee", kind: "expense", total: 500, share: 500,
    categoryId: "food", date: "2026-10-18", note: "", accountId: undefined,
  };
  const base = { ...emptyLedger(), transactions: [original] };
  const local = { ...base, transactions: [{ ...original, title: "Lunch" }] };
  const remoteAdded = { ...original, id: "two", title: "Tea" };
  const remote = { ...base, transactions: [{ ...original, note: "with Sam" }, remoteAdded] };
  const merged = mergeLedger(base, local, remote);
  expect(merged.transactions).toEqual([{ ...original, title: "Lunch", note: "with Sam" }, remoteAdded]);
});

test("removing an optional field locally survives a simultaneous remote edit", () => {
  const original: Transaction = {
    id: "one", title: "Coffee", kind: "expense", total: 500, share: 500,
    categoryId: "food", date: "2026-10-18", note: "", accountId: "card",
  };
  const base = { ...emptyLedger(), transactions: [original] };
  const { accountId: _removed, ...unlinked } = original;
  const local = { ...base, transactions: [unlinked] };
  const remote = { ...base, transactions: [{ ...original, note: "Morning" }] };
  expect(mergeLedger(base, local, remote).transactions[0]).toEqual({ ...unlinked, note: "Morning", accountId: undefined });
});
