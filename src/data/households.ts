import { api } from "./api";
import type { Receipt } from "../domain/ledger";

export type Household = { id: string; name: string; currency: string; creatorId: string; createdAt: number; memberCount: number; trip?: { startDate: string; endDate: string } };
export type HouseholdMember = { userId: string; email: string; joinedAt: number; joinedOn?: string; leftAt?: number | null; active?: boolean };
export type HouseholdExpense = {
  id: string; householdId: string; title: string; totalCents: number; date: string;
  payerUserId: string; splitMode: "equal" | "exact" | "percent";
  splits: { userId: string; amountCents: number }[];
  payments: { fromUserId: string; amountCents: number; createdAt: number; createdBy: string }[];
  paymentsClosed: boolean;
  category: { name: string; icon: string; color: string };
  note: string; accountId?: string; receiptId?: string; receipt?: Receipt;
  revision: number; createdAt: number; createdBy: string; updatedBy?: string; updatedAt?: number;
};
export type ExpenseInput = Pick<HouseholdExpense, "title" | "totalCents" | "date" | "payerUserId" | "splitMode" | "category"> & {
  allocations?: ({ userId: string; amountCents: number } | { userId: string; percentBasisPoints: number })[];
  note?: string; accountId?: string; receiptId?: string; timezoneOffsetMinutes?: number;
};
export type Reimbursement = { id: string; householdId: string; fromUserId: string; toUserId: string; amountCents: number; month: string; createdAt: number; createdBy: string; expenseId?: string };
export type Transfer = { fromUserId: string; toUserId: string; amountCents: number };
export type MonthRecap = {
  month: string; expenses: HouseholdExpense[]; reimbursements: Reimbursement[];
  balances: { userId: string; balanceCents: number }[]; suggestions: Transfer[]; overdue: boolean; overdueMonths?: string[];
};
export type AuditEvent = { id: string; householdId: string; action: string; actorId: string; createdAt: number; before?: unknown; after?: unknown; expenseId?: string };
export type ProjectedExpense = {
  id: string; householdId: string; householdName: string; householdCurrency?: string; title: string; date: string;
  totalCents: number; shareCents: number; category: { name: string; icon: string; color: string };
  note: string; receiptId?: string; receipt?: Receipt; payerUserId: string; accountId?: string;
  scheduled?: boolean; recurringId?: string;
};
export type HouseholdRecurring = Omit<ExpenseInput, "date"> & {
  id: string; householdId: string; nextDate: string; frequency: "weekly" | "monthly" | "yearly";
  anchorDay: number; active: boolean; revision: number;
};

const json = async <T>(path: string, options?: RequestInit): Promise<T> => (await api(path, options)).json();
const body = (value: unknown) => JSON.stringify(value);
const id = (value: string) => encodeURIComponent(value);

export const listHouseholds = () => json<{ households: Household[] }>("/households");
export const createHousehold = (name: string, currency: string) => json<{ household: Household }>("/households", { method: "POST", body: body({ name, currency, timezoneOffsetMinutes: new Date().getTimezoneOffset() }) });
export const createSharedTrip = (name: string, currency: string, startDate: string, endDate: string) => json<{ household: Household }>("/households/trips", { method: "POST", body: body({ name, currency, startDate, endDate, timezoneOffsetMinutes: new Date().getTimezoneOffset() }) });
export const updateSharedTrip = (householdId: string, name: string, startDate: string, endDate: string) => json<{ household: Household }>(`/households/${id(householdId)}/trip`, { method: "PATCH", body: body({ name, startDate, endDate }) });
export const joinHousehold = (code: string) => json<{ household: Household }>("/households/join", { method: "POST", body: body({ code, timezoneOffsetMinutes: new Date().getTimezoneOffset() }) });
export const getHousehold = (householdId: string) => json<{ household: Household; members: HouseholdMember[] }>(`/households/${id(householdId)}`);
export const renameHousehold = (householdId: string, name: string) => json<{ household: Household }>(`/households/${id(householdId)}`, { method: "PATCH", body: body({ name }) });
export const archiveHousehold = (householdId: string) => json<{ ok: true }>(`/households/${id(householdId)}/archive`, { method: "POST" });
export const createInvite = (householdId: string) => json<{ code: string; expiresAt: number }>(`/households/${id(householdId)}/invites`, { method: "POST" });
export const leaveHousehold = (householdId: string) => json<{ ok: true }>(`/households/${id(householdId)}/leave`, { method: "POST" });
export const removeMember = (householdId: string, userId: string) => json<{ ok: true }>(`/households/${id(householdId)}/members/${id(userId)}`, { method: "DELETE" });
export const listExpenses = (householdId: string, month?: string) => json<{ expenses: HouseholdExpense[] }>(`/households/${id(householdId)}/expenses${month ? `?month=${id(month)}` : ""}`);
export const getExpense = (householdId: string, expenseId: string) => json<{ expense: HouseholdExpense }>(`/households/${id(householdId)}/expenses/${id(expenseId)}`);
export const createExpense = (householdId: string, input: ExpenseInput) => json<{ expense: HouseholdExpense }>(`/households/${id(householdId)}/expenses`, { method: "POST", body: body(input) });
export const updateExpense = (householdId: string, expenseId: string, revision: number, input: ExpenseInput, targetHouseholdId?: string) => json<{ expense: HouseholdExpense }>(`/households/${id(householdId)}/expenses/${id(expenseId)}`, { method: "PUT", body: body({ ...input, revision, ...(targetHouseholdId ? { targetHouseholdId } : {}) }) });
export const deleteExpense = (householdId: string, expenseId: string, revision: number) => json<{ ok: true }>(`/households/${id(householdId)}/expenses/${id(expenseId)}`, { method: "DELETE", body: body({ revision }) });
export const payExpense = (householdId: string, expenseId: string, input: { fromUserId: string; revision: number }) => json<{ expense: HouseholdExpense }>(`/households/${id(householdId)}/expenses/${id(expenseId)}/payments`, { method: "POST", body: body(input) });
export const getMonth = (householdId: string, month: string) => json<MonthRecap>(`/households/${id(householdId)}/months/${id(month)}`);
export const reimburse = (householdId: string, month: string, transfer: Transfer) => json<{ reimbursement: Reimbursement }>(`/households/${id(householdId)}/months/${id(month)}/reimbursements`, { method: "POST", body: body(transfer) });
export const getAudit = (householdId: string, expenseId?: string) => json<{ events: AuditEvent[] }>(`/households/${id(householdId)}/audit${expenseId ? `?expenseId=${id(expenseId)}` : ""}`);
export const getProjection = (period: string) => json<{ transactions: ProjectedExpense[]; scheduled: ProjectedExpense[] }>(`/households/projection?${period.length === 4 ? "year" : "month"}=${id(period)}`);
export const listRecurring = (householdId: string) => json<{ rules: HouseholdRecurring[] }>(`/households/${id(householdId)}/recurring`);
export const createRecurring = (householdId: string, input: ExpenseInput & { nextDate: string; frequency: HouseholdRecurring["frequency"] }) => json<{ rule: HouseholdRecurring }>(`/households/${id(householdId)}/recurring`, { method: "POST", body: body(input) });
export const updateRecurring = (householdId: string, ruleId: string, revision: number, input: ExpenseInput & { nextDate: string; frequency: HouseholdRecurring["frequency"]; active: boolean }) => json<{ rule: HouseholdRecurring }>(`/households/${id(householdId)}/recurring/${id(ruleId)}`, { method: "PUT", body: body({ ...input, revision }) });
export const deleteRecurring = (householdId: string, ruleId: string, revision: number) => json<{ ok: true }>(`/households/${id(householdId)}/recurring/${id(ruleId)}`, { method: "DELETE", body: body({ revision }) });
