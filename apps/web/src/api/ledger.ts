import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { apiFetch } from "./client";
import { userKey } from "./keys";

export const CURRENCIES = ["CAD", "USD", "EUR", "GBP"] as const;
export const currencySchema = z.enum(CURRENCIES);
export type Currency = z.infer<typeof currencySchema>;

/**
 * The personal ledger snapshot, read loosely: only the fields the web uses so far are checked,
 * and everything else is kept as-is (`looseObject`) so a write sends back exactly what it read.
 * The full ledger model arrives with the ledger screens (MAZ-87+).
 */
const ledgerSnapshotSchema = z.object({
  revision: z.number().int().min(0),
  ledger: z.looseObject({
    currency: currencySchema,
    transactions: z.array(z.unknown()).optional(),
    recurring: z.array(z.unknown()).optional(),
  }),
});

export type LedgerSnapshot = z.infer<typeof ledgerSnapshotSchema>;

export const ledgerKey = (email: string) => userKey(email, "ledger");

/** The account's ledger snapshot. Screens select what they need from the one cached copy. */
export const ledgerQuery = (email: string) =>
  queryOptions({
    queryKey: ledgerKey(email),
    queryFn: ({ signal }) => apiFetch("/api/ledger", ledgerSnapshotSchema, { signal }),
    staleTime: 5 * 60_000,
  });

/** The account's ledger currency, which personal entries are denominated in. */
export const ledgerCurrencyQuery = (email: string) =>
  queryOptions({
    ...ledgerQuery(email),
    select: (snapshot): Currency => snapshot.ledger.currency,
  });

/**
 * Whether the currency can still change. One currency per account keeps
 * totals consistent, so it is fixed once any entry or recurring rule exists. `unknown` when the
 * server didn't send the lists (never guess that a ledger is empty).
 */
export function currencyLock(snapshot: LedgerSnapshot): "open" | "locked" | "unknown" {
  const { transactions, recurring } = snapshot.ledger;
  if (!transactions || !recurring) return "unknown";
  return transactions.length > 0 || recurring.length > 0 ? "locked" : "open";
}

/**
 * Writes the snapshot back with a new currency. The API rejects a stale `revision` with 409, so a
 * change made elsewhere is never overwritten; the caller refetches and asks again.
 */
export async function changeCurrency(snapshot: LedgerSnapshot, currency: Currency): Promise<LedgerSnapshot> {
  return apiFetch("/api/ledger", ledgerSnapshotSchema, {
    method: "PUT",
    body: { revision: snapshot.revision, ledger: { ...snapshot.ledger, currency } },
  });
}

export function setLedgerSnapshot(queryClient: QueryClient, email: string, snapshot: LedgerSnapshot) {
  queryClient.setQueryData(ledgerKey(email), snapshot);
}

/**
 * The whole snapshot, for the durable offline store (MAZ-87, `src/offline/`), which checks the
 * ledger itself. `PUT` is a compare-and-swap on `revision`: 409 when another write landed first.
 */
const rawSnapshotSchema = z.object({ revision: z.number().int().min(0), ledger: z.unknown() });
export type RawLedgerSnapshot = z.infer<typeof rawSnapshotSchema>;

export function readLedgerSnapshot(): Promise<RawLedgerSnapshot> {
  return apiFetch("/api/ledger", rawSnapshotSchema);
}

export function writeLedgerSnapshot(snapshot: RawLedgerSnapshot): Promise<RawLedgerSnapshot> {
  return apiFetch("/api/ledger", rawSnapshotSchema, { method: "PUT", body: snapshot });
}

/** A server snapshot the offline store recorded, as the Query copy (`ledgerQuery`) holds it. */
export function toLedgerSnapshot(snapshot: RawLedgerSnapshot): LedgerSnapshot | null {
  const parsed = ledgerSnapshotSchema.safeParse(snapshot);
  return parsed.success ? parsed.data : null;
}
