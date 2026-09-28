import type { Frequency } from "./ledger";

// Shared records live outside the private Ledger snapshot. All amounts are integer cents.
export type Household = {
  id: string;
  name: string;
  currency: string;
  creatorUserId: string;
  createdAt: string;
  archivedAt?: string;
};

export type HouseholdMember = {
  householdId: string;
  userId: string;
  displayName: string;
  joinedOn: string;
  // The departure day is excluded from future expenses and recurring occurrences.
  leftOn?: string;
};

export type HouseholdSplit = { userId: string; amountCents: number };
export type SplitInput =
  | { mode: "equal"; memberIds: string[] }
  | { mode: "exact"; allocations: HouseholdSplit[] }
  | { mode: "percent"; allocations: { userId: string; percentBasisPoints: number }[] };

export type HouseholdCategory = {
  name: string;
  icon: string;
  color: string;
};

export type SharedExpense = {
  id: string;
  householdId: string;
  title: string;
  totalCents: number;
  payerUserId: string;
  date: string;
  splits: HouseholdSplit[];
  category?: HouseholdCategory;
  note?: string;
  receiptId?: string;
  // Private to the payer. APIs must omit this for every other member.
  payerAccountId?: string;
  recurringId?: string;
  revision?: number;
  createdByUserId?: string;
  updatedByUserId?: string;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string;
};

export type HouseholdRecurring = {
  id: string;
  householdId: string;
  title: string;
  totalCents: number;
  payerUserId: string;
  category?: HouseholdCategory;
  note?: string;
  frequency: Frequency;
  nextDate: string;
  anchorDay: number;
  active: boolean;
  splitInput: SplitInput;
};

export type HouseholdReimbursement = {
  id: string;
  householdId: string;
  month: string;
  fromUserId: string;
  toUserId: string;
  amountCents: number;
  recordedByUserId?: string;
  recordedAt?: string;
};

export type HouseholdAuditEvent = {
  id: string;
  householdId: string;
  actorUserId: string;
  action: "expense.created" | "expense.edited" | "expense.deleted" |
    "reimbursement.recorded" | "member.joined" | "member.left" |
    "household.edited" | "recurring.created" | "recurring.edited" | "recurring.deleted";
  entityId: string;
  occurredAt: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
};

export type HouseholdTransactionProjection = {
  source: "household";
  id: string;
  expenseId: string;
  householdId: string;
  householdName: string;
  title: string;
  kind: "expense";
  total: number;
  share: number;
  date: string;
  category: HouseholdCategory;
  note: string;
  payerUserId: string;
  payerAccountId?: string;
};

export type HouseholdBalance = { userId: string; balanceCents: number };
export type SuggestedReimbursement = {
  fromUserId: string;
  toUserId: string;
  amountCents: number;
};

function assertCents(value: number, label: string, allowZero = false): void {
  if (!Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) {
    throw new Error(`${label} must be a positive integer number of cents.`);
  }
}

function sortedUniqueIds(ids: string[]): string[] {
  if (!ids.length || ids.some((id) => !id.trim()) || new Set(ids).size !== ids.length) {
    throw new Error("A split needs distinct members.");
  }
  return [...ids].sort();
}

/** Deterministic cent allocation; ties go to the lexically first member ID. */
export function calculateHouseholdSplits(totalCents: number, input: SplitInput): HouseholdSplit[] {
  assertCents(totalCents, "Expense total");
  if (input.mode === "equal") {
    const ids = sortedUniqueIds(input.memberIds);
    const base = Math.floor(totalCents / ids.length);
    const remainder = totalCents % ids.length;
    return ids.map((userId, index) => ({ userId, amountCents: base + (index < remainder ? 1 : 0) }));
  }

  const ids = sortedUniqueIds(input.allocations.map((item) => item.userId));
  const allocations = new Map(input.allocations.map((item) => [item.userId, item]));
  if (input.mode === "exact") {
    const splits = ids.map((userId) => ({ userId, amountCents: (allocations.get(userId) as HouseholdSplit).amountCents }));
    for (const split of splits) assertCents(split.amountCents, "Member share", true);
    if (splits.reduce((sum, split) => sum + split.amountCents, 0) !== totalCents) {
      throw new Error("Exact shares must add up to the expense total.");
    }
    return splits;
  }

  const percents = ids.map((userId) => ({
    userId,
    percentBasisPoints: (allocations.get(userId) as { percentBasisPoints: number }).percentBasisPoints,
  }));
  for (const item of percents) {
    if (!Number.isInteger(item.percentBasisPoints) || item.percentBasisPoints < 0 || item.percentBasisPoints > 10000) {
      throw new Error("Percentages must be between 0 and 100 with at most two decimal places.");
    }
  }
  if (percents.reduce((sum, item) => sum + item.percentBasisPoints, 0) !== 10000) {
    throw new Error("Percentages must add up to 100%.");
  }
  // Divide before multiplying, so even safe-integer totals cannot overflow during weighting.
  const quotient = Math.floor(totalCents / 10000);
  const remainder = totalCents % 10000;
  const weighted = percents.map(({ userId, percentBasisPoints }) => {
    const minor = remainder * percentBasisPoints;
    return {
      userId,
      amountCents: quotient * percentBasisPoints + Math.floor(minor / 10000),
      leftover: minor % 10000,
    };
  });
  let centsLeft = totalCents - weighted.reduce((sum, item) => sum + item.amountCents, 0);
  for (const item of [...weighted].sort((a, b) => b.leftover - a.leftover || a.userId.localeCompare(b.userId))) {
    if (centsLeft-- <= 0) break;
    item.amountCents += 1;
  }
  return weighted.map(({ userId, amountCents }) => ({ userId, amountCents }));
}

/** Membership windows use calendar days; `leftOn` is exclusive. */
export function activeMemberIds(members: HouseholdMember[], onDate: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(onDate)) throw new Error("Use a YYYY-MM-DD date.");
  return [...new Set(members
    .filter((member) => member.joinedOn <= onDate && (!member.leftOn || onDate < member.leftOn))
    .map((member) => member.userId))].sort();
}

/** Preserve an explicit split while the same people remain; otherwise split the next occurrence equally. */
export function calculateRecurringSplits(rule: HouseholdRecurring, members: HouseholdMember[], date: string): HouseholdSplit[] {
  const activeIds = activeMemberIds(members.filter((member) => member.householdId === rule.householdId), date);
  if (!activeIds.length) throw new Error("A recurring expense needs an active household member.");
  const templateIds = rule.splitInput.mode === "equal"
    ? rule.splitInput.memberIds
    : rule.splitInput.allocations.map((item) => item.userId);
  const sameMembers = activeIds.length === templateIds.length &&
    activeIds.every((id) => templateIds.includes(id));
  return calculateHouseholdSplits(rule.totalCents, sameMembers ? rule.splitInput : { mode: "equal", memberIds: activeIds });
}

/** Positive balance means the household owes the member. Months are independent. */
export function calculateMonthlyBalances(
  month: string,
  expenses: SharedExpense[],
  reimbursements: HouseholdReimbursement[],
): HouseholdBalance[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Use a YYYY-MM month.");
  const balances = new Map<string, number>();
  const add = (userId: string, amount: number) => balances.set(userId, (balances.get(userId) ?? 0) + amount);
  for (const expense of expenses) {
    if (expense.deletedAt || expense.date.slice(0, 7) !== month) continue;
    assertCents(expense.totalCents, "Expense total");
    if (expense.splits.reduce((sum, split) => sum + split.amountCents, 0) !== expense.totalCents) {
      throw new Error(`Expense ${expense.id} has shares that do not add up to its total.`);
    }
    add(expense.payerUserId, expense.totalCents);
    for (const split of expense.splits) {
      assertCents(split.amountCents, "Member share", true);
      add(split.userId, -split.amountCents);
    }
  }
  for (const reimbursement of reimbursements) {
    if (reimbursement.month !== month) continue;
    assertCents(reimbursement.amountCents, "Reimbursement");
    if (reimbursement.fromUserId === reimbursement.toUserId) throw new Error("A member cannot reimburse themself.");
    add(reimbursement.fromUserId, reimbursement.amountCents);
    add(reimbursement.toUserId, -reimbursement.amountCents);
  }
  return [...balances].map(([userId, balanceCents]) => ({ userId, balanceCents }))
    .sort((a, b) => a.userId.localeCompare(b.userId));
}

/** Greedy matching produces at most debtors + creditors - 1 full transfers. */
export function suggestReimbursements(balances: HouseholdBalance[]): SuggestedReimbursement[] {
  if (new Set(balances.map((item) => item.userId)).size !== balances.length) {
    throw new Error("Balances must contain each member once.");
  }
  for (const item of balances) {
    if (!Number.isSafeInteger(item.balanceCents)) throw new Error("Balances must use integer cents.");
  }
  if (balances.reduce((sum, item) => sum + item.balanceCents, 0) !== 0) {
    throw new Error("Household balances must net to zero.");
  }
  const debtors = balances.filter((item) => item.balanceCents < 0)
    .map((item) => ({ userId: item.userId, cents: -item.balanceCents }))
    .sort((a, b) => b.cents - a.cents || a.userId.localeCompare(b.userId));
  const creditors = balances.filter((item) => item.balanceCents > 0)
    .map((item) => ({ userId: item.userId, cents: item.balanceCents }))
    .sort((a, b) => b.cents - a.cents || a.userId.localeCompare(b.userId));
  const suggestions: SuggestedReimbursement[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amountCents = Math.min(debtor.cents, creditor.cents);
    suggestions.push({ fromUserId: debtor.userId, toUserId: creditor.userId, amountCents });
    debtor.cents -= amountCents;
    creditor.cents -= amountCents;
    if (debtor.cents === 0) debtorIndex++;
    if (creditor.cents === 0) creditorIndex++;
  }
  return suggestions;
}

export function monthIsOverdue(month: string, today: string, balances: HouseholdBalance[]): boolean {
  return month < today.slice(0, 7) && balances.some((item) => item.balanceCents !== 0);
}
