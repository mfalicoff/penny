import { useQuery } from "@tanstack/react-query";
import { ledgerCurrencyQuery } from "../api/ledger";
import { useAccountEmail } from "../auth/account";
import { useLedgerSync } from "./OfflineLedgerProvider";

export interface LedgerCurrency {
  /** The ledger's currency, which personal entries are denominated in; undefined until known. */
  data: string | undefined;
  /** Penny couldn't learn it: no ledger in this browser, and the server couldn't be read. */
  isError: boolean;
}

/**
 * The account's ledger currency (MAZ-242). Every `GET /api/ledger` sends every entry, so with the
 * offline store on it comes from the store's copy, which its own sync downloads. Query reads it only
 * when there is no copy and none on its way (the store couldn't read or download one), and in the
 * demo, which stores nothing and already holds the snapshot in Query. `enabled: false` reads nothing.
 */
export function useLedgerCurrency({ enabled = true }: { enabled?: boolean } = {}): LedgerCurrency {
  const email = useAccountEmail();
  const sync = useLedgerSync();
  const local = sync?.ledger?.currency;
  const onItsWay = sync !== null && (sync.phase === "loading" || sync.phase === "syncing");
  const query = useQuery({ ...ledgerCurrencyQuery(email), enabled: enabled && local === undefined && !onItsWay });
  const data = local ?? query.data;
  return { data, isError: data === undefined && query.isError };
}
