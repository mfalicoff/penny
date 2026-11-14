import type { Category, Ledger, Receipt, Transaction } from "./ledger.ts";

// The household projection the API returns (GET /api/households/projection), joined into a
// read-only personal ledger view. Kept with the merge rule as the reference for the fixture tests.
export type Household = { id: string; name: string; currency: string; creatorId: string; createdAt: number; memberCount: number; trip?: { startDate: string; endDate: string } };
export type ProjectedExpense = {
  id: string; householdId: string; householdName: string; householdCurrency: string; title: string; date: string;
  totalCents: number; shareCents: number; category: { name: string; icon: string; color: string };
  note: string; receiptId?: string; receipt?: Receipt; payerUserId: string; accountId?: string;
  scheduled?: boolean; recurringId?: string;
};

export type HouseholdTransaction = Transaction & { householdId: string; householdExpenseId: string; scheduled?: boolean };

// A view of the private ledger. This must never be sent to the ledger snapshot API.
export function ledgerWithHouseholds(ledger: Ledger, projection: ProjectedExpense[]): Ledger {
  const categories: Category[] = [...ledger.categories];
  const transactions: Transaction[] = [...ledger.transactions];
  for (const item of projection) {
    // A household's currency matches its members' ledgers; a row in another currency is left out.
    if (item.householdCurrency !== ledger.currency) continue;
    const categoryId = `household-category:${item.category.name}:${item.category.icon}:${item.category.color}`;
    if (!categories.some((category) => category.id === categoryId)) {
      categories.push({ id: categoryId, kind: "expense", ...item.category });
    }
    const shared: HouseholdTransaction = {
      id: `household:${item.householdId}:${item.id}`,
      householdId: item.householdId,
      householdExpenseId: item.id,
      kind: "expense", title: item.title, date: item.date,
      total: item.totalCents, share: item.shareCents,
      categoryId, note: item.note, accountId: item.accountId, receipt: item.receipt,
      recurringId: item.recurringId, scheduled: item.scheduled,
    };
    transactions.push(shared);
  }
  return { ...ledger, categories, transactions };
}

export function isHouseholdTransaction(value: Transaction): value is HouseholdTransaction {
  return "householdId" in value && "householdExpenseId" in value;
}
