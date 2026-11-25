import { describe, expect, it } from "vitest";
import { emptyLedger, type Ledger, type Transaction } from "../../src/domain/ledger";
import { mergeLedger } from "../../src/domain/merge";

// MAZ-186: the merge looked up removed records with `some` inside `filter`, which took about 40 s
// for 50,000 entries. It is linear now; this bound fails long before a quadratic merge finishes.
const ENTRIES = 50_000;
const BOUND_MS = 5_000;

const entry = (index: number): Transaction => ({
  id: `entry-${index}`,
  title: `Entry ${index}`,
  kind: "expense",
  total: 1_000 + index,
  share: 1_000 + index,
  categoryId: "groceries",
  date: "2026-01-15",
  note: "",
});

describe("mergeLedger at scale", () => {
  it(`merges a ${ENTRIES.toLocaleString("en")}-entry ledger quickly, keeping both sides' changes`, () => {
    const base: Ledger = { ...emptyLedger(), transactions: Array.from({ length: ENTRIES }, (_, index) => entry(index)) };
    // Here: one entry edited, one deleted, one added. On the server: another entry edited.
    const local: Ledger = {
      ...base,
      transactions: [...base.transactions.filter((item) => item.id !== "entry-2").map((item) => (item.id === "entry-1" ? { ...item, title: "Edited here" } : item)), entry(ENTRIES)],
    };
    const remote: Ledger = { ...base, transactions: base.transactions.map((item) => (item.id === "entry-3" ? { ...item, total: 9_999, share: 9_999 } : item)) };

    const started = performance.now();
    const merged = mergeLedger(base, local, remote);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(BOUND_MS);
    const byId = new Map(merged.transactions.map((item) => [item.id, item]));
    expect(merged.transactions).toHaveLength(ENTRIES);
    expect(byId.get("entry-1")?.title).toBe("Edited here");
    expect(byId.has("entry-2")).toBe(false);
    expect(byId.get("entry-3")?.total).toBe(9_999);
    expect(byId.has(`entry-${ENTRIES}`)).toBe(true);
  });
});
