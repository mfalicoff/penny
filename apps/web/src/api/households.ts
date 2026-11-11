import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { apiFetch } from "./client";
import { userKey } from "./keys";
import {
  auditEventSchema,
  householdDetailSchema,
  householdSchema,
  inviteSchema,
  monthRecapSchema,
  okSchema,
  reimbursementSchema,
  sharedExpenseSchema,
  sharedRecurringSchema,
  type ExpenseInput,
  type ExpenseUpdate,
  type SharedRecurringInput,
  type SharedRecurringUpdate,
  type Transfer,
} from "./schemas";
import { invalidateSearch } from "./search";

/**
 * Shared households, expenses, settlement and audit (MAZ-56–59 on the server, MAZ-91 here).
 * Shared data is online-only: it lives on the server, never in the durable offline store, so
 * every write here goes straight to the API and a failure leaves the caller's draft untouched.
 */

const segment = (value: string) => encodeURIComponent(value);
const base = (householdId: string) => `/api/households/${segment(householdId)}` as const;

/** The caller's local UTC offset, so the server records their local join day (legacy `getTimezoneOffset`). */
export const timezoneOffsetMinutes = () => Math.max(-840, Math.min(720, new Date().getTimezoneOffset()));

/* ---------- keys ---------- */

/** Every household list for the account. */
export const householdsKey = (email: string) => userKey(email, "households");
/** Everything cached for one household: detail, months, expenses, audit, rules. */
export const householdKey = (email: string, householdId: string) => userKey(email, "household", householdId);

/* ---------- reads ---------- */

export const householdsQuery = (email: string) =>
  queryOptions({
    queryKey: householdsKey(email),
    queryFn: ({ signal }) => apiFetch("/api/households", z.object({ households: z.array(householdSchema) }), { signal }),
    select: (data) => data.households,
  });

export const householdDetailQuery = (email: string, householdId: string) =>
  queryOptions({
    queryKey: [...householdKey(email, householdId), "detail"],
    queryFn: ({ signal }) => apiFetch(base(householdId), householdDetailSchema, { signal }),
  });

export const monthRecapQuery = (email: string, householdId: string, month: string) =>
  queryOptions({
    queryKey: [...householdKey(email, householdId), "month", month],
    queryFn: ({ signal }) => apiFetch(`${base(householdId)}/months/${segment(month)}`, monthRecapSchema, { signal }),
  });

/** Every live expense the caller can see (shared trips list the whole trip, not one month). */
export const householdExpensesQuery = (email: string, householdId: string) =>
  queryOptions({
    queryKey: [...householdKey(email, householdId), "expenses"],
    queryFn: ({ signal }) => apiFetch(`${base(householdId)}/expenses`, z.object({ expenses: z.array(sharedExpenseSchema) }), { signal }),
    select: (data) => data.expenses,
  });

export const expenseQuery = (email: string, householdId: string, expenseId: string) =>
  queryOptions({
    queryKey: [...householdKey(email, householdId), "expense", expenseId],
    queryFn: ({ signal }) => apiFetch(`${base(householdId)}/expenses/${segment(expenseId)}`, z.object({ expense: sharedExpenseSchema }), { signal }),
    select: (data) => data.expense,
  });

/** The household's change history, or one expense's when `expenseId` is given. Newest first. */
export const auditQuery = (email: string, householdId: string, expenseId?: string) =>
  queryOptions({
    queryKey: [...householdKey(email, householdId), "audit", expenseId ?? null],
    queryFn: ({ signal }) =>
      apiFetch(`${base(householdId)}/audit${expenseId ? `?expenseId=${segment(expenseId)}` : ""}`, z.object({ events: z.array(auditEventSchema) }), { signal }),
    select: (data) => data.events,
  });

export const recurringQuery = (email: string, householdId: string) =>
  queryOptions({
    queryKey: [...householdKey(email, householdId), "recurring"],
    queryFn: ({ signal }) => apiFetch(`${base(householdId)}/recurring`, z.object({ rules: z.array(sharedRecurringSchema) }), { signal }),
    select: (data) => data.rules,
  });

/* ---------- writes ---------- */

const householdEnvelope = z.object({ household: householdSchema });
const expenseEnvelope = z.object({ expense: sharedExpenseSchema });
const ruleEnvelope = z.object({ rule: sharedRecurringSchema });

export const createHousehold = (name: string, currency: string) =>
  apiFetch("/api/households", householdEnvelope, { method: "POST", body: { name, currency, timezoneOffsetMinutes: timezoneOffsetMinutes() } });

/** Joins with an invite code. Codes are 10 hex characters; spaces, dashes and dots people type are dropped. */
export const joinHousehold = (code: string) =>
  apiFetch("/api/households/join", householdEnvelope, { method: "POST", body: { code: normalizeInviteCode(code), timezoneOffsetMinutes: timezoneOffsetMinutes() } });

export function normalizeInviteCode(code: string): string {
  return code.replace(/[\s·.-]/g, "").toUpperCase();
}

export const renameHousehold = (householdId: string, name: string) =>
  apiFetch(base(householdId), householdEnvelope, { method: "PATCH", body: { name } });
export const createInvite = (householdId: string) => apiFetch(`${base(householdId)}/invites`, inviteSchema, { method: "POST" });
export const leaveHousehold = (householdId: string) => apiFetch(`${base(householdId)}/leave`, okSchema, { method: "POST" });
export const removeMember = (householdId: string, userId: string) =>
  apiFetch(`${base(householdId)}/members/${segment(userId)}`, okSchema, { method: "DELETE" });
export const archiveHousehold = (householdId: string) => apiFetch(`${base(householdId)}/archive`, okSchema, { method: "POST" });

export const createExpense = (householdId: string, input: ExpenseInput) =>
  apiFetch(`${base(householdId)}/expenses`, expenseEnvelope, { method: "POST", body: input });
export const updateExpense = (householdId: string, expenseId: string, input: ExpenseUpdate) =>
  apiFetch(`${base(householdId)}/expenses/${segment(expenseId)}`, expenseEnvelope, { method: "PUT", body: input });
export const deleteExpense = (householdId: string, expenseId: string, revision: number) =>
  apiFetch(`${base(householdId)}/expenses/${segment(expenseId)}`, okSchema, { method: "DELETE", body: { revision } });
/** Records that `fromUserId` already paid their whole share of one expense. It never moves money. */
export const recordSharePayment = (householdId: string, expenseId: string, fromUserId: string, revision: number) =>
  apiFetch(`${base(householdId)}/expenses/${segment(expenseId)}/payments`, expenseEnvelope, { method: "POST", body: { fromUserId, revision } });
/** Records a full suggested monthly transfer that already happened outside Penny. */
export const recordMonthlyPayment = (householdId: string, month: string, transfer: Transfer) =>
  apiFetch(`${base(householdId)}/months/${segment(month)}/reimbursements`, z.object({ reimbursement: reimbursementSchema }), {
    method: "POST",
    body: { fromUserId: transfer.fromUserId, toUserId: transfer.toUserId, amountCents: transfer.amountCents },
  });

export const createRule = (householdId: string, input: SharedRecurringInput) =>
  apiFetch(`${base(householdId)}/recurring`, ruleEnvelope, { method: "POST", body: input });
export const updateRule = (householdId: string, ruleId: string, input: SharedRecurringUpdate) =>
  apiFetch(`${base(householdId)}/recurring/${segment(ruleId)}`, ruleEnvelope, { method: "PUT", body: input });
export const deleteRule = (householdId: string, ruleId: string, revision: number) =>
  apiFetch(`${base(householdId)}/recurring/${segment(ruleId)}`, okSchema, { method: "DELETE", body: { revision } });

/* ---------- after a write ---------- */

/**
 * Called after every successful shared write. Balances, suggestions, audit and member lists are
 * all derived on the server, so instead of patching the cache the household's queries are marked
 * stale and the ones on screen refetch; the household list (member counts) and search (shared
 * rows) follow. Durable offline personal edits are not in Query and are never touched.
 */
export async function refreshHousehold(queryClient: QueryClient, email: string, householdId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: householdKey(email, householdId) }),
    queryClient.invalidateQueries({ queryKey: householdsKey(email) }),
    invalidateSearch(queryClient, email),
  ]);
}

/** After leaving, removal of oneself or archiving: drop the household's cache so nothing stale stays readable. */
export async function forgetHousehold(queryClient: QueryClient, email: string, householdId: string): Promise<void> {
  queryClient.removeQueries({ queryKey: householdKey(email, householdId) });
  await Promise.all([queryClient.invalidateQueries({ queryKey: householdsKey(email) }), invalidateSearch(queryClient, email)]);
}
