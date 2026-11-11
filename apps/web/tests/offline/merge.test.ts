// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { materialize, type Ledger } from "@domain/ledger.ts";
import { mergeOfflineLedger, occurrenceOf, untouchedOccurrenceDate } from "../../src/offline/merge";
import { ledger, rule } from "./harness";

/** The browser's merge (shared merge plus the native recurrence refinements). Synthetic data only. */

const golden = JSON.parse(readFileSync(new URL("../../../../contracts/fixtures/merge-conflicts.json", import.meta.url), "utf8")) as {
  cases: { name: string; base: Ledger; local: Ledger; remote: Ledger; expected: Ledger }[];
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const ids = (value: Ledger) => value.transactions.map((entry) => entry.id);

/** The base this browser synced on Oct 31 (rule due Nov 1), and its offline catch-up on Nov 10. */
function caughtUp(extra: Partial<ReturnType<typeof rule>> = {}) {
  const base = ledger({ recurring: [rule("pass", { nextDate: "2026-11-01", ...extra })] });
  const local = materialize(clone(base), "2026-11-10");
  return { base, local };
}

describe("mergeOfflineLedger", () => {
  it("matches every golden merge case (contracts/fixtures/merge-conflicts.json)", () => {
    for (const item of golden.cases) expect(clone(mergeOfflineLedger(item.base, item.local, item.remote)), item.name).toEqual(item.expected);
  });

  it("keeps a rule deleted on another device deleted after an offline catch-up, with its untouched occurrence", () => {
    const { base, local } = caughtUp();
    expect(ids(local)).toEqual(["pass:2026-11-01"]);
    const remote = ledger({ recurring: [] });
    const merged = mergeOfflineLedger(base, local, remote);
    expect(merged.recurring).toEqual([]);
    expect(merged.transactions).toEqual([]);
    // Materializing the result records nothing either.
    expect(materialize(merged, "2026-11-10").transactions).toEqual([]);
  });

  it("brings back a deleted rule edited here in another field, with its occurrences", () => {
    const { base, local } = caughtUp();
    local.recurring = local.recurring.map((item) => ({ ...item, title: "Transit pass (zone 2)" }));
    const merged = mergeOfflineLedger(base, local, ledger());
    expect(merged.recurring.map((item) => item.title)).toEqual(["Transit pass (zone 2)"]);
    expect(ids(merged)).toEqual(["pass:2026-11-01"]);
  });

  it("keeps an occurrence edited here even when its rule was deleted on another device", () => {
    const { base, local } = caughtUp();
    local.transactions = local.transactions.map((entry) => ({ ...entry, note: "paid by card" }));
    const merged = mergeOfflineLedger(base, local, ledger());
    expect(merged.recurring).toEqual([]);
    expect(merged.transactions.map((entry) => entry.note)).toEqual(["paid by card"]);
  });

  it("keeps the other device's edit of an occurrence both recorded", () => {
    const { base, local } = caughtUp();
    const remote = materialize(clone(base), "2026-11-10");
    remote.transactions = remote.transactions.map((entry) => ({ ...entry, total: 6500, share: 6500 }));
    const merged = mergeOfflineLedger(base, local, remote);
    expect(merged.transactions.map((entry) => entry.total)).toEqual([6500]);
  });

  it("drops an untouched occurrence the other device recorded and then deleted", () => {
    const { base, local } = caughtUp();
    const remote = materialize(clone(base), "2026-11-10");
    remote.transactions = [];
    const merged = mergeOfflineLedger(base, local, remote);
    expect(merged.transactions).toEqual([]);
    expect(merged.recurring[0]?.nextDate).toBe("2026-12-01");
  });

  it("keeps the later nextDate when both sides advanced a rule", () => {
    const base = ledger({ recurring: [rule("pass", { nextDate: "2026-11-01" })] });
    const local = clone(base);
    local.recurring = [rule("pass", { nextDate: "2026-12-01" })];
    const remote = clone(base);
    remote.recurring = [rule("pass", { nextDate: "2027-01-01" })];
    expect(mergeOfflineLedger(base, local, remote).recurring[0]?.nextDate).toBe("2027-01-01");
    expect(mergeOfflineLedger(base, remote, local).recurring[0]?.nextDate).toBe("2027-01-01");
  });

  it("keeps occurrences of a rule created here, which the server never had", () => {
    const base = ledger();
    const local = materialize({ ...clone(base), recurring: [rule("new", { nextDate: "2026-11-05" })] }, "2026-11-10");
    const merged = mergeOfflineLedger(base, local, ledger());
    expect(ids(merged)).toEqual(["new:2026-11-05"]);
    expect(merged.recurring.map((item) => item.id)).toEqual(["new"]);
  });

  it("recognizes untouched occurrences regardless of key order and absent fields", () => {
    const item = rule("pass", { accountId: undefined });
    const generated = occurrenceOf(item, "2026-11-01");
    const reordered = Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(generated)) as object).reverse()) as typeof generated;
    const base = ledger({ recurring: [item] });
    expect(untouchedOccurrenceDate(reordered, base, base)).toBe("2026-11-01");
    expect(untouchedOccurrenceDate({ ...reordered, note: "edited" }, base, base)).toBeNull();
    expect(untouchedOccurrenceDate({ ...reordered, id: "pass-2026-11-01" }, base, base)).toBeNull();
  });
});
