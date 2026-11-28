import type { Ledger, Receipt } from "@domain/ledger.ts";
import type { QueryClient } from "@tanstack/react-query";
import { createExpense, refreshHousehold, timezoneOffsetMinutes } from "../../api/households";
import { refreshPurchases, reopenPurchase, resolvePurchase } from "../../api/purchaseInbox";
import { fetchRates, isOffline, lastKnownRates } from "../../api/rates";
import { refreshInbox } from "../../api/receiptInbox";
import type { CardAccount, Household, PurchaseInboxItem, SharedCategory } from "../../api/schemas";
import { invalidateSearch } from "../../api/search";
import { resolveRate } from "../entries/currency";
import { buildEntry, entryChange, minorToInput, newDraft, type DraftRate, type EntryDraft } from "../entries/model";
import type { LedgerWriter } from "../entries/writer";
import { accountForCard, purchaseDay, suggestCategory } from "./model";

/**
 * Triage of a captured purchase (MAZ-291). Add saves the entry with the normal save (a personal
 * entry through the durable offline store, a shared expense online), then records the outcome on
 * the server so every device stops offering the purchase. If recording fails, the entry is kept
 * and the purchase stays in To review, where its new entry shows as a match to attach.
 */

/** The personal draft Add starts from: the merchant, the amount in its own currency, the day, the suggested category and the card's account. */
export function purchaseDraft(ledger: Ledger, item: PurchaseInboxItem, cards: readonly CardAccount[]): EntryDraft {
  const date = purchaseDay(item);
  const draft = newDraft(ledger, "expense", date);
  const foreign = item.currency !== ledger.currency;
  return {
    ...draft,
    title: item.merchant.slice(0, 100),
    amount: minorToInput(item.amount, item.currency),
    categoryId: suggestCategory(ledger, item.merchant)?.category.id ?? draft.categoryId,
    accountId: accountForCard(cards, item.card, ledger) ?? "",
    currency: foreign ? item.currency : null,
  };
}

/** The published (or provisional) rate for `code` on `date` in `home`, or null when there is none to use. */
export async function lookUpRate(queryClient: QueryClient, email: string, home: string, code: string, date: string): Promise<DraftRate | null> {
  try {
    const found = resolveRate(code, { answer: await fetchRates(queryClient, email, home, date), offline: false, failed: false, cached: null });
    return found.state === "rate" ? { rate: found.rate.rate, status: found.rate.status, rateDate: found.rate.rateDate } : null;
  } catch (error) {
    const found = resolveRate(code, { offline: isOffline(error), failed: true, cached: lastKnownRates(home) });
    return found.state === "rate" ? { rate: found.rate.rate, status: found.rate.status, rateDate: found.rate.rateDate } : null;
  }
}

export class TriageError extends Error {}

/** Saves a built personal entry from the purchase and records it as added. */
export async function addPersonal(writer: Pick<LedgerWriter, "save" | "ledger">, item: PurchaseInboxItem, draft: EntryDraft, rate: DraftRate | null): Promise<{ entryId: string; offline: boolean }> {
  if (!writer.save || !writer.ledger) throw new TriageError("This browser can't save entries right now.");
  const result = buildEntry(draft, writer.ledger, undefined, rate);
  const first = Object.values(result.errors)[0];
  if (!result.built) throw new TriageError(first ?? "Check the expense and try again.");
  const saved = await writer.save(entryChange(result.built));
  await resolvePurchase(item.id, { outcome: "added", entryId: result.built.transaction.id });
  return { entryId: result.built.transaction.id, offline: saved.savedOffline };
}

/** Adds the purchase to a household or shared trip, split equally and paid by the person, then records it. */
export async function addShared(
  item: PurchaseInboxItem,
  household: Pick<Household, "id">,
  input: { title: string; totalCents: number; payerUserId: string; category: SharedCategory; date: string; accountId?: string | undefined; receiptId?: string | undefined },
): Promise<string> {
  const { expense } = await createExpense(household.id, {
    title: input.title,
    totalCents: input.totalCents,
    payerUserId: input.payerUserId,
    splitMode: "equal",
    category: input.category,
    note: "",
    date: input.date,
    ...(input.accountId ? { accountId: input.accountId } : {}),
    ...(input.receiptId ? { receiptId: input.receiptId } : {}),
    timezoneOffsetMinutes: timezoneOffsetMinutes(),
  });
  await resolvePurchase(item.id, { outcome: "added", entryId: expense.id, householdId: household.id });
  return expense.id;
}

/** The purchase is the same as an entry that already exists: nothing new is added. */
export const attachToEntry = (item: PurchaseInboxItem, entryId: string, householdId?: string) =>
  resolvePurchase(item.id, { outcome: "attached", entryId, ...(householdId ? { householdId } : {}) });

/** The draft for "Attach to this" on an emailed receipt: one expense, with the receipt on it. */
export const withReceipt = (draft: EntryDraft, receipt: Receipt): EntryDraft => ({ ...draft, receipt });

export const discardPurchase = (item: PurchaseInboxItem) => resolvePurchase(item.id, { outcome: "discarded" });
export const undoDiscard = (item: PurchaseInboxItem) => reopenPurchase(item.id);

/** After a triage: the purchases, the emailed receipts (an attach moves one), search and the household. */
export async function afterTriage(queryClient: QueryClient, email: string, householdId?: string | null): Promise<void> {
  await Promise.all([
    refreshPurchases(queryClient, email),
    refreshInbox(queryClient, email),
    invalidateSearch(queryClient, email),
    householdId ? refreshHousehold(queryClient, email, householdId) : Promise.resolve(),
  ]);
}
