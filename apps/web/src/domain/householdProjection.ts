import type { Category, Ledger, Receipt, Transaction } from "./ledger.ts";

// The household projection the API returns (GET /api/households/projection), joined into a
// read-only personal ledger view. Kept with the merge rule as the reference for the fixture tests.
export type Household = { id: string; name: string; currency: string; creatorId: string; createdAt: number; memberCount: number; trip?: { startDate: string; endDate: string } };
export type ProjectedExpense = {
  id: string; householdId: string; householdName: string; householdCurrency: string; title: string; date: string;
  totalCents: number; shareCents: number; category: { name: string; icon: string; color: string };
  note: string; receiptId?: string; receipt?: Receipt; payerUserId: string; accountId?: string;
  scheduled?: boolean; recurringId?: string;
  // MAZ-275: who paid, as the household sees them, and whether it was you. Optional, so older rows stay valid.
  payer?: ExpensePayer; paidByYou?: boolean;
};
/** Who paid a shared expense (MAZ-275). `deleted`: show "Former member", never the email. */
export type ExpensePayer = { email: string; displayName?: string; deleted?: true };

export type HouseholdTransaction = Transaction & { householdId: string; householdExpenseId: string; scheduled?: boolean; paidByYou?: boolean; payer?: ExpensePayer };

const categoryKey = (name: string) => name.trim().toLowerCase();

// The category a shared expense counts under in the personal view. A shared expense carries its
// household's copy of the category by value, so it joins the person's own expense category with
// the same name, compared trimmed and without case (icon and colour may differ): the first such
// category in ledger order. With no match it keeps a category of its own,
// `household-category:<name>:<icon>:<color>`. Income and investment categories never match: a
// shared expense is an expense. `personal` is the ledger's own categories, not the view's.
export function sharedCategoryId(personal: readonly Category[], category: ProjectedExpense["category"]): string {
  const key = categoryKey(category.name);
  const match = key ? personal.find((item) => item.kind === "expense" && categoryKey(item.name) === key) : undefined;
  return match?.id ?? `household-category:${category.name}:${category.icon}:${category.color}`;
}

// A view of the private ledger. This must never be sent to the ledger snapshot API.
export function ledgerWithHouseholds(ledger: Ledger, projection: ProjectedExpense[]): Ledger {
  const categories: Category[] = [...ledger.categories];
  const transactions: Transaction[] = [...ledger.transactions];
  for (const item of projection) {
    // A household's currency matches its members' ledgers; a row in another currency is left out.
    if (item.householdCurrency !== ledger.currency) continue;
    const categoryId = sharedCategoryId(ledger.categories, item.category);
    if (!categories.some((category) => category.id === categoryId)) {
      categories.push({ id: categoryId, kind: "expense", ...item.category });
    }
    const shared: HouseholdTransaction = {
      id: `household:${item.householdId}:${item.id}`,
      householdId: item.householdId,
      householdExpenseId: item.id,
      kind: "expense", title: item.title, date: item.date,
      total: item.totalCents, share: item.shareCents,
      categoryId, note: item.note,
      ...(item.accountId !== undefined && { accountId: item.accountId }),
      ...(item.receipt !== undefined && { receipt: item.receipt }),
      ...(item.recurringId !== undefined && { recurringId: item.recurringId }),
      ...(item.scheduled !== undefined && { scheduled: item.scheduled }),
      ...(item.paidByYou !== undefined && { paidByYou: item.paidByYou }),
      ...(item.payer !== undefined && { payer: item.payer }),
    };
    transactions.push(shared);
  }
  return { ...ledger, categories, transactions };
}

export function isHouseholdTransaction(value: Transaction): value is HouseholdTransaction {
  return "householdId" in value && "householdExpenseId" in value;
}
