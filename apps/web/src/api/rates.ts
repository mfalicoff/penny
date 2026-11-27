import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { DEMO_EMAIL } from "../demo/demoServer";
import { ApiError, apiFetch } from "./client";
import { userKey } from "./keys";
import { exchangeRatesSchema, type ExchangeRates } from "./schemas";

/**
 * `GET /api/rates?base=&date=` (contract 2.4.0, MAZ-151): the reference rates the server fetched
 * from the European Central Bank, in the ledger's home currency, for an entry's date. The entry
 * form asks when its currency or date changes; after a sync, provisional entries ask again for
 * their date (`useProvisionalRates`).
 *
 * The last answer per home currency is kept in this browser (`localStorage["penny.rates"]`), so an
 * entry made offline still converts: with the latest known rate, marked provisional, which the next
 * sync replaces. Rates are public reference data, the same for every account on the server; the
 * demo never writes them, since it stores nothing.
 */
export const RATES_STORAGE_KEY = "penny.rates";

export const ratesKey = (email: string, base: string, date: string) => userKey(email, "rates", base, date);

export const ratesQuery = (email: string, base: string, date: string) =>
  queryOptions({
    queryKey: ratesKey(email, base, date),
    queryFn: async ({ signal }) => {
      const answer = await apiFetch(`/api/rates?base=${encodeURIComponent(base)}&date=${encodeURIComponent(date)}`, exchangeRatesSchema, { signal });
      if (email !== DEMO_EMAIL) rememberRates(answer);
      return answer;
    },
    // The server caches for an hour (`Cache-Control: private, max-age=3600`); a day's rates change once.
    staleTime: 60 * 60_000,
  });

const storedSchema = z.record(z.string(), exchangeRatesSchema);

function readStored(): Record<string, ExchangeRates> {
  try {
    const raw = localStorage.getItem(RATES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = storedSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/**
 * Keeps `answer` as the last known rates for its base, unless what is kept is from a later
 * publication (an old date's answer never replaces a newer one).
 */
export function rememberRates(answer: ExchangeRates): void {
  const stored = readStored();
  const kept = stored[answer.base];
  if (kept && answer.enabled && kept.enabled && (kept.rateDate ?? "") > (answer.rateDate ?? "")) return;
  stored[answer.base] = answer;
  try {
    localStorage.setItem(RATES_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage blocked or full: offline entries then ask for a rate instead.
  }
}

/** The last rates this browser got for `base`, or null. */
export function lastKnownRates(base: string): ExchangeRates | null {
  return readStored()[base] ?? null;
}

/** Whether a failed rates request means "no connection" (use the last known rates), not a refusal. */
export function isOffline(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 0 || error.status >= 500);
}

/** Reads the rates for a date through the cache (the form's save and the sync's replacement). */
export function fetchRates(queryClient: QueryClient, email: string, base: string, date: string): Promise<ExchangeRates> {
  return queryClient.query(ratesQuery(email, base, date));
}
