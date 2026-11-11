// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AuditEvent } from "../src/api/schemas";
import {
  describeAudit,
  eligibleMembers,
  equalSplit,
  monthEnd,
  monthlyPaymentsOpen,
  parseAmount,
  parsePercent,
  percentSplit,
  shiftMonth,
} from "../src/features/households/model";
import { normalizeInviteCode } from "../src/api/households";

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../../contracts/fixtures/${name}`, import.meta.url), "utf8"));

type SplitCase = {
  name: string;
  totalCents: number;
  input: { mode: "equal"; memberIds: string[] } | { mode: "exact"; allocations: { userId: string; amountCents: number }[] } | { mode: "percent"; allocations: { userId: string; percentBasisPoints: number }[] };
  expected?: { userId: string; amountCents: number }[];
  error?: boolean;
};

describe("split preview matches the golden server cases (contracts/fixtures/shared-splits.json)", () => {
  const cases = (fixture("shared-splits.json") as { cases: SplitCase[] }).cases.filter((item) => !item.error && item.expected);
  it.each(cases.filter((item) => item.input.mode !== "exact").map((item) => [item.name, item] as const))("%s", (_name, item) => {
    const shares = item.input.mode === "equal" ? equalSplit(item.totalCents, item.input.memberIds) : percentSplit(item.totalCents, (item.input as { allocations: { userId: string; percentBasisPoints: number }[] }).allocations);
    expect(shares).toEqual(item.expected);
    expect(shares.reduce((sum, share) => sum + share.amountCents, 0)).toBe(item.totalCents);
  });
});

describe("amount and percent entry", () => {
  const parse = (fixture("money.json") as { parse: { input: string; cents?: number; error?: string }[] }).parse;
  it.each(parse.map((item) => [item.input, item] as const))("parses %j like the shared money rules", (_input, item) => {
    expect(parseAmount(item.input)).toBe(item.cents ?? null);
  });

  it("reads percentages with up to two decimals as basis points", () => {
    expect(parsePercent("33.33")).toBe(3333);
    expect(parsePercent("50")).toBe(5000);
    expect(parsePercent("12,5 %")).toBe(1250);
    expect(parsePercent("100.01")).toBeNull();
    expect(parsePercent("1.234")).toBeNull();
  });

  it("normalizes invite codes people type with spaces, dots or dashes", () => {
    expect(normalizeInviteCode(" 7f3a9 c01b2 ")).toBe("7F3A9C01B2");
    expect(normalizeInviteCode("7F3A9·C01B2")).toBe("7F3A9C01B2");
    expect(normalizeInviteCode("7F3A9-C01B2")).toBe("7F3A9C01B2");
  });
});

describe("months and settlement timing", () => {
  it("shifts across years and finds month ends, including leap years", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(monthEnd("2028-02")).toBe("2028-02-29");
    expect(monthEnd("2026-09")).toBe("2026-09-30");
  });

  it("opens monthly payments from the month's last day in UTC, as the server does", () => {
    expect(monthlyPaymentsOpen("2026-09", new Date("2026-09-29T23:59:59Z"))).toBe(false);
    expect(monthlyPaymentsOpen("2026-09", new Date("2026-09-30T00:00:00Z"))).toBe(true);
    expect(monthlyPaymentsOpen("2026-08", new Date("2026-09-01T00:00:00Z"))).toBe(true);
  });
});

describe("eligible members", () => {
  const detail = (trip: boolean) => ({
    household: { id: "h", name: "Maison", currency: "CAD" as const, creatorId: "a", createdAt: 0, memberCount: 2, ...(trip ? { trip: { startDate: "2026-10-01", endDate: "2026-10-09" } } : {}) },
    members: [
      { userId: "a", email: "a@example.test", joinedAt: Date.UTC(2026, 8, 1), joinedOn: "2026-09-01" },
      { userId: "b", email: "b@example.test", joinedAt: Date.UTC(2026, 9, 14), joinedOn: "2026-10-14" },
      { userId: "c", email: "c@example.test", joinedAt: Date.UTC(2026, 8, 1), joinedOn: "2026-09-01", leftAt: Date.UTC(2026, 9, 10, 12) },
    ],
  });

  it("uses the members active on the expense date in households", () => {
    expect(eligibleMembers(detail(false), "2026-10-05").map((member) => member.userId)).toEqual(["a", "c"]);
    expect(eligibleMembers(detail(false), "2026-10-10").map((member) => member.userId)).toEqual(["a"]);
    expect(eligibleMembers(detail(false), "2026-10-14").map((member) => member.userId)).toEqual(["a", "b"]);
  });

  it("uses every current member on shared trips", () => {
    expect(eligibleMembers(detail(true), "2026-01-01").map((member) => member.userId)).toEqual(["a", "b"]);
  });
});

describe("audit sentences", () => {
  const name = (id: string) => ({ a: "You", b: "bea@example.test" })[id] ?? "Former member";
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const event = (action: string, before: unknown, after: unknown, actorId = "b"): AuditEvent => ({ id: "1", householdId: "h", actorId, action, before, after, createdAt: 0 });

  it("lists changed fields of an edit with members and money in words", () => {
    const result = describeAudit(
      event("expense.updated", { title: "Hydro", totalCents: 9630, category: { name: "Home" }, payerUserId: "a" }, { title: "Hydro", totalCents: 10410, category: { name: "Bills" }, payerUserId: "b" }),
      name,
      money,
    );
    expect(result.summary).toBe("bea@example.test edited Hydro");
    expect(result.changes).toEqual(["Total: $96.30 → $104.10", "Paid by: You → bea@example.test", "Category: Home → Bills"]);
  });

  it("describes payments and automatic occurrences", () => {
    expect(describeAudit(event("reimbursement.created", null, { fromUserId: "a", toUserId: "b", amountCents: 3000, expenseId: "e" }, "a"), name, money).summary).toBe(
      "You recorded your $30.00 share payment to bea@example.test",
    );
    expect(describeAudit(event("reimbursement.created", null, { fromUserId: "b", toUserId: "a", amountCents: 3000 }), name, money).summary).toBe(
      "bea@example.test recorded bea@example.test paid You $30.00",
    );
    expect(describeAudit(event("expense.created", null, { title: "Rent", totalCents: 290000, splitMode: "exact", recurringId: "r" }), name, money)).toEqual({
      summary: "Rent was added automatically",
      changes: ["$2900.00 · split by amount"],
    });
  });
});
