import { infiniteQueryOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { userKey } from "./keys";
import { okSchema, receiptEmailSchema, receiptInboxCleanupSchema, receiptInboxPageSchema, type ReceiptEmail, type ReceiptEmailUpdate } from "./schemas";

/**
 * Emailed receipts (MAZ-184): the private receipt address (`/api/receipt-email`) and the
 * owner-only receipt inbox (`/api/receipt-inbox`). Attaching has no endpoint of its own: an inbox
 * file is an ordinary receipt, linked by the normal personal ledger save or shared expense save
 * with its `receiptId`, and the server moves the inbox item between states in that same save.
 * Bytes are read with `GET /api/receipts/{id}` like any other receipt.
 */

export type InboxFilter = "to_attach" | "attached";

/** Everything cached for emailed receipts. */
export const receiptEmailKey = (email: string) => userKey(email, "receipt-email");
export const receiptInboxKey = (email: string) => userKey(email, "receipt-inbox");

/**
 * The address settings. The server always answers 200 (`enabled: false` with the feature off);
 * an older server without the route answers 404, which reads the same way: nothing is shown.
 */
export const receiptEmailQuery = (email: string) =>
  queryOptions({
    queryKey: receiptEmailKey(email),
    queryFn: ({ signal }) => apiFetch("/api/receipt-email", receiptEmailSchema, { signal }),
    staleTime: 5 * 60_000,
  });

/** One page of the inbox, newest first (50 per page on the server). */
export const receiptInboxQuery = (email: string, status: InboxFilter) =>
  queryOptions({
    queryKey: [...receiptInboxKey(email), status],
    queryFn: ({ signal }) => apiFetch(`/api/receipt-inbox?status=${status}`, receiptInboxPageSchema, { signal }),
  });

/** The inbox screen's list: the same pages, with older ones loaded on request (`next` is the cursor). */
export const receiptInboxPagesQuery = (email: string, status: InboxFilter) =>
  infiniteQueryOptions({
    queryKey: [...receiptInboxKey(email), status, "pages"],
    queryFn: ({ pageParam, signal }) =>
      apiFetch(`/api/receipt-inbox?status=${status}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ""}`, receiptInboxPageSchema, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
  });

/** Create the address, or rotate it: the old one stops working at once. 429 after too many in a day. */
export const createReceiptAddress = () => apiFetch("/api/receipt-email", receiptEmailSchema, { method: "POST" });
export const updateReceiptEmail = (update: ReceiptEmailUpdate) => apiFetch("/api/receipt-email", receiptEmailSchema, { method: "PATCH", body: update });
/** Turn off: mail to the address is refused. Inbox items stay. */
export const revokeReceiptAddress = () => apiFetch("/api/receipt-email", okSchema, { method: "DELETE" });

const itemPath = (id: string) => `/api/receipt-inbox/${encodeURIComponent(id)}` as const;
/** Deletes the item and its files that nothing links. */
export const discardInboxItem = (id: string) => apiFetch(itemPath(id), receiptInboxCleanupSchema, { method: "DELETE" });
/** Finishes a partly attached item: its unlinked files are deleted, and it moves to Attached. */
export const finishInboxItem = (id: string) => apiFetch(`${itemPath(id)}/done`, receiptInboxCleanupSchema, { method: "POST" });

export function setReceiptEmail(queryClient: QueryClient, email: string, value: ReceiptEmail) {
  queryClient.setQueryData(receiptEmailKey(email), value);
}

/** After anything that can move an inbox item: a save that links or unlinks, Discard, Done. */
export function refreshInbox(queryClient: QueryClient, email: string): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: receiptInboxKey(email) });
}
