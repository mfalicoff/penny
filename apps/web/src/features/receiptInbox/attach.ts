import { saveEntry, type LedgerChange } from "@domain/commands.ts";
import type { Receipt, Transaction } from "@domain/ledger.ts";
import type { QueryClient } from "@tanstack/react-query";
import { expenseQuery, refreshHousehold, timezoneOffsetMinutes, updateExpense } from "../../api/households";
import { refreshInbox } from "../../api/receiptInbox";
import type { ExpenseUpdate, SharedExpense } from "../../api/schemas";
import { invalidateSearch } from "../../api/search";
import type { LedgerWriter } from "../entries/writer";

/**
 * Attaching an inbox file (MAZ-184) is the ordinary save with that file's receipt link: a
 * personal entry is a ledger edit through the durable offline store (it syncs later, offline
 * included), a shared expense is an online `PUT` with the revision it was read at (409 when
 * someone changed it meanwhile). The server moves the inbox item inside those same saves.
 * Undo is the same save again with the receipt the entry had before.
 */

/** An entry with `receipt` set to `next`, or without one. */
export function withReceipt(entry: Transaction, next: Receipt | null): Transaction {
  const copy: Transaction = { ...entry };
  delete copy.receipt;
  return next ? { ...copy, receipt: next } : copy;
}

/**
 * A ledger change that links `next` to entry `entryId`, only if the entry still links `expected`
 * (the receipt the person saw). Anything else about the entry may have changed meanwhile; it is
 * kept as it is now.
 */
export function relinkReceipt(entryId: string, expected: string | null, next: Receipt | null): LedgerChange {
  return (ledger) => {
    const current = ledger.transactions.find((item) => item.id === entryId);
    if (!current) throw new Error("This entry was deleted on another device, so nothing was attached.");
    if ((current.receipt?.id ?? null) !== expected) throw new Error("This entry's receipt changed on another device. Nothing was changed.");
    return saveEntry(withReceipt(current, next), current)(ledger);
  };
}

/** The personal save that links `receipt` in place of `expected`. */
export async function attachPersonal(writer: Pick<LedgerWriter, "save">, entryId: string, expected: string | null, receipt: Receipt | null): Promise<{ offline: boolean }> {
  if (!writer.save) throw new Error("This browser can't save entries right now.");
  const result = await writer.save(relinkReceipt(entryId, expected, receipt));
  return { offline: result.savedOffline };
}

/** The shared expense update body: the expense as read, with `receiptId` set or dropped. */
export function sharedUpdate(expense: SharedExpense, receiptId: string | null): ExpenseUpdate {
  return {
    title: expense.title,
    totalCents: expense.totalCents,
    payerUserId: expense.payerUserId,
    splitMode: expense.splitMode,
    ...(expense.allocations ? { allocations: expense.allocations } : {}),
    category: expense.category,
    note: expense.note,
    // The server sends the payer's private account only to the payer; anyone else leaves it alone.
    ...(expense.accountId ? { accountId: expense.accountId } : {}),
    ...(receiptId ? { receiptId } : {}),
    date: expense.date,
    revision: expense.revision,
    timezoneOffsetMinutes: timezoneOffsetMinutes(),
  };
}

/** The receipt id a shared expense links now, if any. */
export const sharedReceiptId = (expense: SharedExpense) => expense.receipt?.id ?? expense.receiptId ?? null;

export async function attachShared(householdId: string, expense: SharedExpense, receiptId: string | null): Promise<SharedExpense> {
  const { expense: saved } = await updateExpense(householdId, expense.id, sharedUpdate(expense, receiptId));
  return saved;
}

/** The latest copy of a shared expense, bypassing the cache (for Undo and after a 409). */
export function latestExpense(queryClient: QueryClient, email: string, householdId: string, expenseId: string): Promise<SharedExpense> {
  return queryClient.query({ ...expenseQuery(email, householdId, expenseId), staleTime: 0 });
}

/** After a link changed: the inbox, search, and (for shared) the household's screens. */
export async function afterAttach(queryClient: QueryClient, email: string, householdId?: string): Promise<void> {
  await Promise.all([refreshInbox(queryClient, email), householdId ? refreshHousehold(queryClient, email, householdId) : invalidateSearch(queryClient, email)]);
}
