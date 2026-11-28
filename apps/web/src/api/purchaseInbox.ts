import { infiniteQueryOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { userKey } from "./keys";
import { cardAccountsSchema, purchaseInboxItemSchema, purchaseInboxPageSchema, type PurchaseResolution } from "./schemas";

/**
 * Captured purchases in the Inbox (contract 2.5.0, MAZ-291), beside emailed receipts. The iPhone
 * uploads each Apple Pay tap; any device triages it. Triage saves the entry with the normal ledger
 * save or shared expense save first, then records the outcome here (`resolve`), so every device
 * stops offering the purchase. Undo is `reopen`, after undoing the save itself.
 */

export type PurchaseFilter = "to_review" | "done";

export const purchaseInboxKey = (email: string) => userKey(email, "purchase-inbox");
export const cardAccountsKey = (email: string) => userKey(email, "purchase-cards");

/** The first page (50, newest capture first): the Inbox count and Add all. */
export const purchaseInboxQuery = (email: string, status: PurchaseFilter) =>
  queryOptions({
    queryKey: [...purchaseInboxKey(email), status],
    queryFn: ({ signal }) => apiFetch(`/api/purchase-inbox?status=${status}`, purchaseInboxPageSchema, { signal }),
  });

/** The Inbox screen's list, with older pages loaded on request. */
export const purchaseInboxPagesQuery = (email: string, status: PurchaseFilter) =>
  infiniteQueryOptions({
    queryKey: [...purchaseInboxKey(email), status, "pages"],
    queryFn: ({ pageParam, signal }) =>
      apiFetch(`/api/purchase-inbox?status=${status}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ""}`, purchaseInboxPageSchema, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
  });

/** Which account each Wallet card's purchases go to (edited on iOS, Settings › Shortcuts). */
export const cardAccountsQuery = (email: string) =>
  queryOptions({
    queryKey: cardAccountsKey(email),
    queryFn: ({ signal }) => apiFetch("/api/purchase-inbox/cards", cardAccountsSchema, { signal }),
    staleTime: 5 * 60_000,
  });

const itemPath = (id: string) => `/api/purchase-inbox/${encodeURIComponent(id)}` as const;

/** Records how a purchase left To review. The same call again is harmless; another outcome is 409. */
export const resolvePurchase = (id: string, resolution: PurchaseResolution) =>
  apiFetch(`${itemPath(id)}/resolve`, purchaseInboxItemSchema, { method: "POST", body: resolution });

/** Undo: back to To review. */
export const reopenPurchase = (id: string) => apiFetch(`${itemPath(id)}/reopen`, purchaseInboxItemSchema, { method: "POST" });

export function refreshPurchases(queryClient: QueryClient, email: string): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: purchaseInboxKey(email) });
}
