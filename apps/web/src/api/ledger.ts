import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { apiFetch } from "./client";
import { userKey } from "./keys";

export const currencySchema = z.enum(["CAD", "USD", "EUR", "GBP"]);
export type Currency = z.infer<typeof currencySchema>;

// Only the currency is read here; the full ledger model arrives with the ledger screens (MAZ-87+).
const ledgerCurrencySchema = z.object({ ledger: z.object({ currency: currencySchema }) });

/** The account's ledger currency, which personal entries are denominated in. */
export const ledgerCurrencyQuery = (email: string) =>
  queryOptions({
    queryKey: userKey(email, "ledger", "currency"),
    queryFn: ({ signal }) => apiFetch("/api/ledger", ledgerCurrencySchema, { signal }),
    select: (snapshot): Currency => snapshot.ledger.currency,
    staleTime: 5 * 60_000,
  });
