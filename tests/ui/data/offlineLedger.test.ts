import { emptyLedger, type Transaction } from "../../../src/domain/ledger";
import { mergeLedger } from "../../../src/data/offlineLedger";

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
