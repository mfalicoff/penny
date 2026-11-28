import { sharedAmounts, type ProjectedExpense } from "@domain/householdProjection.ts";
import type { ForeignAmount } from "@domain/currency.ts";
import type { Transaction } from "@domain/ledger.ts";
import type { MemberHomeAmounts } from "../../api/schemas";

/**
 * Shared expenses in several currencies on the web (MAZ-151 phase 2, contract 2.5.0). Every rule is
 * the shared domain's (`sharedAmounts`, `memberAmounts`, `settleIn`); this file only adapts the API
 * rows to it and words what the screens show.
 */

/** The fields of a projection row (or a shared expense) the home amounts are read from. */
export type SharedAmountsInput = Pick<ProjectedExpense, "householdCurrency" | "totalCents" | "shareCents"> & {
  originalAmount?: number | undefined;
  originalCurrency?: string | undefined;
  rate?: string | undefined;
  rateStatus?: ForeignAmount["rateStatus"] | undefined;
  rateDate?: string | undefined;
  home?: MemberHomeAmounts | undefined;
};

export type HomeAmounts = Pick<Transaction, "total" | "share"> & Partial<ForeignAmount>;

/**
 * A shared row's amounts in the viewer's home currency, with what was paid when that isn't the
 * home currency (the domain's `sharedAmounts`), or null when it can't be counted: the household is
 * in another currency and no home amounts came with it (no rate known), or the home currency isn't
 * known yet.
 */
export function homeAmountsOf(row: SharedAmountsInput, home: string | undefined): HomeAmounts | null {
  if (!home) return null;
  const { home: amounts, ...rest } = row;
  const input: ProjectedExpense = {
    id: "", householdId: "", householdName: "", title: "", date: "", note: "", payerUserId: "",
    category: { name: "", icon: "", color: "" },
    householdCurrency: rest.householdCurrency, totalCents: rest.totalCents, shareCents: rest.shareCents,
    ...(rest.originalAmount !== undefined && { originalAmount: rest.originalAmount }),
    ...(rest.originalCurrency !== undefined && { originalCurrency: rest.originalCurrency }),
    ...(rest.rate !== undefined && { rate: rest.rate }),
    ...(rest.rateStatus !== undefined && { rateStatus: rest.rateStatus }),
    ...(rest.rateDate !== undefined && { rateDate: rest.rateDate }),
    ...(amounts && {
      home: {
        currency: amounts.currency, totalCents: amounts.totalCents, shareCents: amounts.shareCents,
        ...(amounts.rate !== undefined && { rate: amounts.rate }),
        ...(amounts.rateStatus !== undefined && { rateStatus: amounts.rateStatus }),
        ...(amounts.rateDate !== undefined && { rateDate: amounts.rateDate }),
      },
    }),
  };
  return sharedAmounts(input, home);
}

/** What a shared expense was paid in: its original amount and currency, else its total in the household's. */
export function paidOf(expense: { totalCents: number; originalAmount?: number | undefined; originalCurrency?: string | undefined }, householdCurrency: string) {
  return expense.originalAmount !== undefined && expense.originalCurrency ? { amount: expense.originalAmount, currency: expense.originalCurrency } : { amount: expense.totalCents, currency: householdCurrency };
}

/**
 * The currencies a trip's expenses were paid in, as the cards list them ("EUR, USD and CAD"): the
 * trip's own currency first when an expense was paid in it, then the others in the order they were
 * first used (by date).
 */
export function currenciesPaidIn(expenses: readonly { date: string; id: string; totalCents: number; originalAmount?: number | undefined; originalCurrency?: string | undefined }[], householdCurrency: string): string[] {
  const ordered = [...expenses].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const codes: string[] = [];
  for (const expense of ordered) {
    const code = paidOf(expense, householdCurrency).currency;
    if (!codes.includes(code)) codes.push(code);
  }
  return codes.includes(householdCurrency) ? [householdCurrency, ...codes.filter((code) => code !== householdCurrency)] : codes;
}

/** "EUR", "EUR and USD", "EUR, USD and CAD". */
export function listCodes(codes: readonly string[]): string {
  if (codes.length <= 1) return codes.join("");
  return `${codes.slice(0, -1).join(", ")} and ${codes.at(-1) ?? ""}`;
}

const PLURALS: Record<string, string> = {
  EUR: "euros", USD: "US dollars", CAD: "Canadian dollars", GBP: "pounds", JPY: "yen", AUD: "Australian dollars", CHF: "Swiss francs",
  MXN: "Mexican pesos", NZD: "New Zealand dollars", SEK: "Swedish kronor", NOK: "Norwegian kroner", DKK: "Danish kroner",
};

/** "euros", "US dollars": a currency's plural name for "Balances in euros"; its code for the others ("in THB"). */
export const currencyPlural = (code: string): string => PLURALS[code] ?? code;
