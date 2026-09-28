import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeMemberIds,
  calculateHouseholdSplits,
  calculateMonthlyBalances,
  calculateRecurringSplits,
  monthIsOverdue,
  suggestReimbursements,
  type HouseholdMember,
  type HouseholdRecurring,
  type SharedExpense,
} from "../src/domain/households.ts";

function expense(
  id: string,
  date: string,
  payerUserId: string,
  totalCents: number,
  memberIds: string[],
): SharedExpense {
  return {
    id, householdId: "home", title: id, date, payerUserId, totalCents,
    splits: calculateHouseholdSplits(totalCents, { mode: "equal", memberIds }),
  };
}

test("equal splits give the remainder cent to stable member IDs", () => {
  assert.deepEqual(calculateHouseholdSplits(9000, { mode: "equal", memberIds: ["c", "a", "b"] }), [
    { userId: "a", amountCents: 3000 },
    { userId: "b", amountCents: 3000 },
    { userId: "c", amountCents: 3000 },
  ]);
  assert.deepEqual(calculateHouseholdSplits(10000, { mode: "equal", memberIds: ["c", "b", "a"] }), [
    { userId: "a", amountCents: 3334 },
    { userId: "b", amountCents: 3333 },
    { userId: "c", amountCents: 3333 },
  ]);
});

test("exact and percentage splits add to the total, including rounding", () => {
  assert.deepEqual(calculateHouseholdSplits(10000, {
    mode: "exact", allocations: [
      { userId: "b", amountCents: 7250 }, { userId: "a", amountCents: 2750 },
    ],
  }), [
    { userId: "a", amountCents: 2750 }, { userId: "b", amountCents: 7250 },
  ]);
  assert.deepEqual(calculateHouseholdSplits(1, {
    mode: "percent", allocations: [
      { userId: "c", percentBasisPoints: 3334 },
      { userId: "b", percentBasisPoints: 3333 },
      { userId: "a", percentBasisPoints: 3333 },
    ],
  }), [
    { userId: "a", amountCents: 0 },
    { userId: "b", amountCents: 0 },
    { userId: "c", amountCents: 1 },
  ]);
  const result = calculateHouseholdSplits(101, {
    mode: "percent", allocations: [
      { userId: "a", percentBasisPoints: 5000 },
      { userId: "b", percentBasisPoints: 5000 },
    ],
  });
  assert.deepEqual(result.map((item) => item.amountCents), [51, 50]);
});

test("invalid amounts, members, and percentages are rejected", () => {
  assert.throws(() => calculateHouseholdSplits(0, { mode: "equal", memberIds: ["a"] }));
  assert.throws(() => calculateHouseholdSplits(100, { mode: "equal", memberIds: ["a", "a"] }));
  assert.throws(() => calculateHouseholdSplits(100, { mode: "exact", allocations: [{ userId: "a", amountCents: 99 }] }));
  assert.throws(() => calculateHouseholdSplits(100, { mode: "exact", allocations: [{ userId: "a", amountCents: 100.5 }] }));
  assert.throws(() => calculateHouseholdSplits(100, { mode: "percent", allocations: [{ userId: "a", percentBasisPoints: 9999 }] }));
});

test("three-person month suggests both remaining members pay the payer", () => {
  const expenses = [expense("groceries", "2026-01-12", "alex", 9000, ["alex", "blair", "casey"])];
  const balances = calculateMonthlyBalances("2026-01", expenses, []);
  assert.deepEqual(balances, [
    { userId: "alex", balanceCents: 6000 },
    { userId: "blair", balanceCents: -3000 },
    { userId: "casey", balanceCents: -3000 },
  ]);
  assert.deepEqual(suggestReimbursements(balances), [
    { fromUserId: "blair", toUserId: "alex", amountCents: 3000 },
    { fromUserId: "casey", toUserId: "alex", amountCents: 3000 },
  ]);
});

test("settlement only affects its own month and an old month remains overdue", () => {
  const expenses = [
    expense("jan", "2026-01-31", "alex", 8000, ["alex", "blair"]),
    expense("feb", "2026-02-01", "blair", 2000, ["alex", "blair"]),
  ];
  const january = calculateMonthlyBalances("2026-01", expenses, []);
  const february = calculateMonthlyBalances("2026-02", expenses, []);
  assert.deepEqual(suggestReimbursements(january), [
    { fromUserId: "blair", toUserId: "alex", amountCents: 4000 },
  ]);
  assert.deepEqual(suggestReimbursements(february), [
    { fromUserId: "alex", toUserId: "blair", amountCents: 1000 },
  ]);
  assert.equal(monthIsOverdue("2026-01", "2026-02-03", january), true);
  const settledJanuary = calculateMonthlyBalances("2026-01", expenses, [{
    id: "repayment", householdId: "home", month: "2026-01",
    fromUserId: "blair", toUserId: "alex", amountCents: 4000,
  }]);
  assert.deepEqual(suggestReimbursements(settledJanuary), []);
  assert.equal(monthIsOverdue("2026-01", "2026-02-03", settledJanuary), false);
  assert.deepEqual(calculateMonthlyBalances("2026-02", expenses, []), february);
});

test("editing a reimbursed expense exposes the remaining monthly difference", () => {
  const original = expense("rent", "2026-01-15", "alex", 8000, ["alex", "blair"]);
  const reimbursement = {
    id: "repayment", householdId: "home", month: "2026-01",
    fromUserId: "blair", toUserId: "alex", amountCents: 4000,
  };
  const edited = { ...original, totalCents: 10000, splits: calculateHouseholdSplits(10000, { mode: "equal" as const, memberIds: ["alex", "blair"] }) };
  assert.deepEqual(suggestReimbursements(calculateMonthlyBalances("2026-01", [edited], [reimbursement])), [
    { fromUserId: "blair", toUserId: "alex", amountCents: 1000 },
  ]);
});

test("member departures preserve history and change future recurring splits", () => {
  const members: HouseholdMember[] = [
    { householdId: "home", userId: "alex", displayName: "Alex", joinedOn: "2026-01-01" },
    { householdId: "home", userId: "blair", displayName: "Blair", joinedOn: "2026-01-01", leftOn: "2026-03-01" },
    { householdId: "home", userId: "casey", displayName: "Casey", joinedOn: "2026-02-01" },
  ];
  assert.deepEqual(activeMemberIds(members, "2026-01-31"), ["alex", "blair"]);
  assert.deepEqual(activeMemberIds(members, "2026-02-01"), ["alex", "blair", "casey"]);
  assert.deepEqual(activeMemberIds(members, "2026-03-01"), ["alex", "casey"]);
  const rule: HouseholdRecurring = {
    id: "rent", householdId: "home", title: "Rent", totalCents: 9000,
    payerUserId: "alex", frequency: "monthly", nextDate: "2026-01-01",
    anchorDay: 1, active: true, splitInput: { mode: "equal", memberIds: ["alex", "blair"] },
  };
  assert.deepEqual(calculateRecurringSplits(rule, members, "2026-01-01").map((item) => item.amountCents), [4500, 4500]);
  assert.deepEqual(calculateRecurringSplits(rule, members, "2026-02-01").map((item) => item.amountCents), [3000, 3000, 3000]);
  assert.deepEqual(calculateRecurringSplits(rule, members, "2026-03-01").map((item) => item.userId), ["alex", "casey"]);
});
