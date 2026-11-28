import { useQuery } from "@tanstack/react-query";
import { cardAccountsQuery, purchaseInboxQuery } from "../../api/purchaseInbox";
import type { CardAccount, PurchaseInboxItem } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";
import { useIsDemo } from "../../demo/demo";

export interface PurchaseStatus {
  /** Purchases waiting in To review (first page), or empty while loading, on an error or in the demo. */
  items: PurchaseInboxItem[];
  count: number;
  /** More than one page is waiting. */
  more: boolean;
  /** The list answered (or failed, which reads as none). */
  loaded: boolean;
}

/** Captured purchases waiting in To review (MAZ-291). The demo has none and asks nothing. */
export function usePurchaseStatus(): PurchaseStatus {
  const email = useAccountEmail();
  const demo = useIsDemo();
  const query = useQuery({ ...purchaseInboxQuery(email, "to_review"), enabled: !demo });
  const items = demo ? [] : (query.data?.items ?? []);
  return { items, count: items.length, more: !demo && Boolean(query.data?.next), loaded: demo || !query.isPending };
}

/** The card-to-account mapping (edited on iOS). Empty while loading or when the server has none. */
export function useCardAccounts(enabled = true): CardAccount[] {
  const email = useAccountEmail();
  const demo = useIsDemo();
  const query = useQuery({ ...cardAccountsQuery(email), enabled: enabled && !demo });
  return query.data?.cards ?? [];
}
