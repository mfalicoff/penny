import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { receiptEmailQuery, receiptInboxQuery, refreshInbox } from "../../api/receiptInbox";
import type { ReceiptEmail, ReceiptInboxItem } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";
import { useIsDemo } from "../../demo/demo";
import { useLedgerSync } from "../../offline/OfflineLedgerProvider";

export interface InboxStatus {
  /** The server accepts emailed receipts. False also while loading, on an error, or in the demo. */
  enabled: boolean;
  settings: ReceiptEmail | undefined;
  /** The settings answered (or failed, which reads as off). */
  loaded: boolean;
  /** Items waiting in To attach (first page), or empty while loading. */
  items: ReceiptInboxItem[];
  /** "Receipts to attach" is shown: the feature is on and an address exists, or items are waiting. */
  visible: boolean;
  /** How many are waiting, and whether there are more than one page holds. */
  count: number;
  more: boolean;
}

/**
 * Whether emailed receipts are on, and the To attach count (MAZ-184). With the feature off on the
 * server nothing about it is shown anywhere. The demo has no inbox and asks nothing.
 */
export function useInboxStatus(): InboxStatus {
  const email = useAccountEmail();
  const demo = useIsDemo();
  const settings = useQuery({ ...receiptEmailQuery(email), enabled: !demo });
  const enabled = !demo && settings.data?.enabled === true;
  const inbox = useQuery({ ...receiptInboxQuery(email, "to_attach"), enabled });
  const items = enabled ? (inbox.data?.items ?? []) : [];
  return {
    enabled,
    settings: settings.data,
    loaded: demo || !settings.isPending,
    items,
    visible: enabled && (Boolean(settings.data?.address) || items.length > 0),
    count: items.length,
    more: enabled && Boolean(inbox.data?.next),
  };
}

/**
 * Personal attaches are ledger edits that sync later; the server moves the inbox item when the
 * sync lands. Refresh the inbox each time this browser's pending entries change, so an item shows
 * "Attaching…" only until then.
 */
export function useInboxSyncRefresh(enabled: boolean) {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const sync = useLedgerSync();
  const pending = sync?.pending.entryIds.join(",") ?? "";
  const last = useRef(pending);
  useEffect(() => {
    if (!enabled || last.current === pending) return;
    last.current = pending;
    void refreshInbox(queryClient, email);
  }, [enabled, pending, queryClient, email]);
}

/**
 * Receipt ids being attached from this browser: linked by an entry change that hasn't synced yet.
 * The inbox shows those files as "Attaching…" instead of waiting to be attached.
 */
export function useAttachingReceipts(): ReadonlySet<string> {
  const sync = useLedgerSync();
  const ids = new Set<string>();
  if (!sync?.ledger) return ids;
  const pending = new Set(sync.pending.entryIds);
  for (const entry of sync.ledger.transactions) if (pending.has(entry.id) && entry.receipt) ids.add(entry.receipt.id);
  return ids;
}
