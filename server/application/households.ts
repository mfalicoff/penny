/** Household operations exposed to HTTP; persistence is supplied by infrastructure. */
export interface HouseholdService {
  list(userId: string): unknown;
  create(userId: string, body: unknown): unknown;
  get(householdId: string, userId: string): unknown;
  rename(householdId: string, userId: string, body: unknown): unknown;
  archive(householdId: string, userId: string): unknown;
  invite(householdId: string, userId: string): unknown;
  join(userId: string, body: unknown): unknown;
  leave(householdId: string, userId: string): unknown;
  remove(householdId: string, actorId: string, userId: string): unknown;
  expenses(householdId: string, userId: string, month?: string): unknown;
  getExpense(householdId: string, userId: string, expenseId: string): unknown;
  createExpense(householdId: string, userId: string, body: unknown): unknown;
  updateExpense(householdId: string, userId: string, expenseId: string, body: unknown): unknown;
  deleteExpense(householdId: string, userId: string, expenseId: string, body: unknown): unknown;
  month(householdId: string, userId: string, month: string): unknown;
  reimburse(householdId: string, userId: string, month: string, body: unknown): unknown;
  audit(householdId: string, userId: string, expenseId?: string): unknown;
  projection(userId: string, month?: string, year?: string): unknown;
  recurring(householdId: string, userId: string): unknown;
  createRecurring(householdId: string, userId: string, body: unknown): unknown;
  updateRecurring(householdId: string, userId: string, ruleId: string, body: unknown): unknown;
  deleteRecurring(householdId: string, userId: string, ruleId: string, body: unknown): unknown;
}
