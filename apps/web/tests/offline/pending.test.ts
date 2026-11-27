// @vitest-environment node
import { describe, expect, it } from "vitest";
import { emptyLedger } from "@domain/ledger.ts";
import { NOTHING_PENDING, pendingChanges } from "../../src/offline/pending";

/** What waits to sync (MAZ-87), including suggestion dismissals (MAZ-290). Synthetic data only. */
describe("pendingChanges", () => {
  it("counts a dismissed suggestion and an Undo as changes to sync, and nothing once they match", () => {
    const base = emptyLedger();
    const dismissed = { ...base, dismissedSuggestions: ["expense|netflix|monthly|1699"] };
    expect(pendingChanges(base, dismissed).count).toBe(1);
    expect(pendingChanges(dismissed, { ...dismissed, dismissedSuggestions: [] }).count).toBe(1);
    expect(pendingChanges(dismissed, { ...dismissed })).toBe(NOTHING_PENDING);
    // An absent list and an empty one are the same: nothing to sync.
    expect(pendingChanges(base, { ...base, dismissedSuggestions: [] })).toBe(NOTHING_PENDING);
  });
});
