// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AuditEvent, SharedExpense } from "../src/api/schemas";
import {
  byWeek,
  describeAudit,
  eligibleMembers,
  equalSplit,
  monthEnd,
  monthlyPaymentsOpen,
  parseAmount,
  parsePercent,
  percentSplit,
  shiftMonth,
  staleChange,
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
    expect(result.edits[2]).toEqual({ label: "Category", before: "Home", after: "Bills" });
    expect(result.emphasis).toEqual(["bea@example.test", "Hydro"]);
  });

  it("describes payments and automatic occurrences", () => {
    // As on `iphone-history`: "You recorded Jo's payment", with the amount under it.
    expect(describeAudit(event("reimbursement.created", null, { fromUserId: "a", toUserId: "b", amountCents: 3000, expenseId: "e" }, "a"), name, money)).toMatchObject({
      summary: "You recorded a payment",
      changes: ["$30.00 share to bea@example.test"],
      emphasis: ["You"],
    });
    expect(describeAudit(event("reimbursement.created", null, { fromUserId: "b", toUserId: "a", amountCents: 3000 }), name, money)).toMatchObject({
      summary: "bea@example.test recorded a payment",
      changes: ["$30.00 to You for the month"],
    });
    expect(describeAudit(event("expense.created", null, { title: "Rent", totalCents: 290000, splitMode: "exact", recurringId: "r" }), name, money)).toEqual({
      summary: "Rent was added automatically",
      changes: ["$2900.00 · split by amount"],
      edits: [],
      emphasis: ["Rent"],
    });
    expect(describeAudit(event("member.joined", null, { userId: "b" }), name, money, "trip").summary).toBe("bea@example.test joined the trip");
  });

  it("describes invitations by email without naming the address", () => {
    expect(describeAudit(event("invite.emailed", null, { expiresAt: 1_800_000_000_000 }, "a"), name, money)).toMatchObject({ summary: "You emailed an invitation", changes: [] });
    expect(describeAudit(event("invite.revoked", { expiresAt: 1_800_000_000_000 }, null), name, money).summary).toBe("bea@example.test revoked an invitation");
  });
});

describe("staleChange names why a share payment went stale", () => {
  const before = {
    id: "e1",
    householdId: "h1",
    title: "Internet",
    date: "2026-10-05",
    totalCents: 8000,
    payerUserId: "bea",
    splitMode: "equal",
    category: { name: "Home", icon: "home", color: "#C27C4E" },
    splits: [
      { userId: "alex", amountCents: 4000 },
      { userId: "bea", amountCents: 4000 },
    ],
    revision: 1,
    createdBy: "bea",
    createdAt: 1,
    updatedBy: "alex",
    updatedAt: 2,
    payments: [],
    paymentsClosed: false,
  } as unknown as SharedExpense;
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const name = (userId: string) => (userId === "alex" ? "You" : userId);

  it("reads another payment as the cause and lists only the status that changed", () => {
    const now = { ...before, revision: 2, payments: [{ fromUserId: "alex", amountCents: 4000, createdAt: 5, createdBy: "alex" }] };
    expect(staleChange(before, now, "alex", money, name)).toEqual({
      cause: { kind: "payment", recordedBy: "alex", fromUserId: "alex", at: 5 },
      rows: [{ label: "Your share status", before: "Not repaid yet", now: "Repaid" }],
    });
  });

  it("reads a closed month as a monthly payment", () => {
    const now = { ...before, revision: 2, paymentsClosed: true };
    expect(staleChange(before, now, "alex", money, name)).toEqual({
      cause: { kind: "monthly" },
      rows: [{ label: "Your share status", before: "Not repaid yet", now: "Settles with the month" }],
    });
  });

  it("reads changed content as an edit and lists only amounts that changed", () => {
    const now = {
      ...before,
      revision: 2,
      totalCents: 9000,
      splits: [
        { userId: "alex", amountCents: 4500 },
        { userId: "bea", amountCents: 4500 },
      ],
      updatedBy: "bea",
      updatedAt: 9,
    };
    expect(staleChange(before, now, "alex", money, name)).toEqual({
      cause: { kind: "edit", editedBy: "bea", at: 9 },
      rows: [
        { label: "Total", before: "$80.00", now: "$90.00" },
        { label: "Your share", before: "$40.00", now: "$45.00" },
      ],
    });
  });

  it("lists nothing when an edit changed no amount", () => {
    const now = { ...before, revision: 2, title: "Fibre", updatedBy: "bea", updatedAt: 9 };
    expect(staleChange(before, now, "alex", money, name).rows).toEqual([]);
  });
});

describe("byWeek (ipad-shared)", () => {
  const expense = (id: string, date: string) => ({ id, date }) as SharedExpense;
  const now = new Date(2026, 10, 9, 12);

  it("puts the last seven days, today included, under This week and the rest under Earlier", () => {
    const groups = byWeek([expense("a", "2026-11-09"), expense("b", "2026-11-03"), expense("c", "2026-11-02"), expense("d", "2026-11-01")], now);
    expect(groups.map((group) => [group.label, group.expenses.map((item) => item.id)])).toEqual([
      ["This week", ["a", "b"]],
      ["Earlier", ["c", "d"]],
    ]);
  });

  it("leaves out an empty group", () => {
    expect(byWeek([expense("a", "2026-10-02")], now).map((group) => group.label)).toEqual(["Earlier"]);
    expect(byWeek([], now)).toEqual([]);
  });
});
