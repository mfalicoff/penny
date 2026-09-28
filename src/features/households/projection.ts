import type { ProjectedExpense, Household } from "../../data/households";
import type { Category, Ledger, Transaction } from "../../domain/ledger";

export type HouseholdTransaction = Transaction & { householdId: string; householdExpenseId: string };

// A view of the private ledger. This must never be sent to the ledger snapshot API.
export function ledgerWithHouseholds(ledger: Ledger, projection: ProjectedExpense[], households: Household[]): Ledger {
  const currencies = new Map(households.map((household) => [household.id, household.currency]));
  const categories: Category[] = [...ledger.categories];
  const transactions: Transaction[] = [...ledger.transactions];
  for (const item of projection) {
    if ((item.householdCurrency ?? currencies.get(item.householdId)) !== ledger.currency) continue;
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
    };
    transactions.push(shared);
  }
  return { ...ledger, categories, transactions };
}

export function isHouseholdTransaction(value: Transaction): value is HouseholdTransaction {
  return "householdId" in value && "householdExpenseId" in value;
}
