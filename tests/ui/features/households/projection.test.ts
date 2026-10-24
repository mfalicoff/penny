import { emptyLedger } from "../../../../src/domain/ledger";
import type { Household, ProjectedExpense } from "../../../../src/data/households";
import { selectOverview } from "../../../../src/features/overview/selectors";
import { selectTransactions } from "../../../../src/features/transactions/selectors";
import { isHouseholdTransaction, ledgerWithHouseholds } from "../../../../src/features/households/projection";

const household: Household = { id: "h1", name: "Home", currency: "CAD", creatorId: "alice", createdAt: 1, memberCount: 3 };
const expense: ProjectedExpense = {
  id: "e1", householdId: "h1", householdName: "Home", title: "Groceries", date: "2026-09-20",
  totalCents: 9000, shareCents: 3000, payerUserId: "alice",
  category: { name: "Groceries", icon: "basket-outline", color: "#6C9C79" }, note: "Weekly shop",
};

test("a shared member share appears in every personal report without changing private snapshot data", () => {
  const privateLedger = emptyLedger();
  const view = ledgerWithHouseholds(privateLedger, [expense], [household]);
  expect(privateLedger.transactions).toEqual([]);
  expect(view.transactions).toHaveLength(1);
  expect(isHouseholdTransaction(view.transactions[0])).toBe(true);
  expect(view.transactions[0]).toMatchObject({ total: 9000, share: 3000 });

  const overview = selectOverview(view, { month: "2026-09", day: null, filter: "all", search: "groceries" });
  expect(overview.summary.expense).toBe(3000);
  expect(overview.spending).toMatchObject([{ amount: 3000 }]);
  expect(overview.visibleEntries).toHaveLength(1);

  const transactions = selectTransactions(view, { month: "2026-09", period: "month", filter: "all", search: "", page: 0 });
  expect(transactions.summary.expense).toBe(3000);
  expect(transactions.visibleEntries).toHaveLength(1);
});
