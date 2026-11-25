// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ledgerWriteSchema } from "../src/validation/ledger";
import { editEntry, random, summarize, syntheticLedger } from "../scripts/ledger-bench/synthetic";

describe("ledger sync baseline: synthetic ledgers", () => {
  it("is deterministic for a seed", () => {
    expect(syntheticLedger({ entries: 300, seed: 4 })).toEqual(syntheticLedger({ entries: 300, seed: 4 }));
    expect(syntheticLedger({ entries: 300, seed: 4 })).not.toEqual(syntheticLedger({ entries: 300, seed: 5 }));
    const next = random(1);
    const values = Array.from({ length: 1000 }, next);
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it("is a ledger the API accepts, with the requested size and unique ids", () => {
    const ledger = syntheticLedger({ entries: 2000 });
    expect(ledger.transactions).toHaveLength(2000);
    expect(new Set(ledger.transactions.map((entry) => entry.id)).size).toBe(2000);
    expect(ledgerWriteSchema.safeParse({ revision: 0, ledger }).success).toBe(true);
    expect(ledgerWriteSchema.safeParse({ revision: 0, ledger: editEntry(ledger, 7, 3) }).success).toBe(true);
  });

  it("dates entries before today and schedules rules after it, so nothing materializes during a run", () => {
    const ledger = syntheticLedger({ entries: 2000, today: "2026-11-25" });
    expect(ledger.transactions.every((entry) => entry.date >= "2023-01-01" && entry.date < "2026-11-25")).toBe(true);
    expect(ledger.recurring.every((rule) => rule.nextDate > "2026-11-25")).toBe(true);
  });

  it("edits exactly one entry", () => {
    const ledger = syntheticLedger({ entries: 50 });
    const edited = editEntry(ledger, 7, 1);
    const changed = edited.transactions.filter((entry, index) => JSON.stringify(entry) !== JSON.stringify(ledger.transactions[index]));
    expect(changed.map((entry) => entry.id)).toEqual([ledger.transactions[7]?.id]);
    expect(changed[0]?.title).toBe("Edited 1");
    expect(JSON.stringify(editEntry(ledger, 7, 2))).not.toBe(JSON.stringify(edited));
  });
});

describe("ledger sync baseline: summaries", () => {
  it("gives the median, nearest-rank p90, min and max", () => {
    expect(summarize([5, 1, 3, 2, 4])).toEqual({ runs: 5, median: 3, p90: 5, min: 1, max: 5 });
    expect(summarize([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])).toMatchObject({ median: 50, p90: 90 });
    expect(() => summarize([])).toThrow();
  });
});

describe("ledger sync baseline: module resolution", () => {
  it("maps @domain and extensionless relative imports the way Vite does", async () => {
    const { viteLikeTarget } = await import("../scripts/ledger-bench/hooks");
    const engine = new URL("../src/offline/engine.ts", import.meta.url).href;
    expect(viteLikeTarget("@domain/merge.ts", engine)).toBe(new URL("../src/domain/merge.ts", import.meta.url).href);
    expect(viteLikeTarget("./wire", engine)).toBe(new URL("../src/offline/wire.ts", import.meta.url).href);
    expect(viteLikeTarget("./missing", engine)).toBeNull();
    expect(viteLikeTarget("./wire.ts", engine)).toBeNull();
    expect(viteLikeTarget("zod", engine)).toBeNull();
  });
});
