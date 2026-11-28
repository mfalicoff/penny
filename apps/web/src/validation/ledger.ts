// The ledger write contract (`PUT /api/ledger` body) as a zod schema: the reference the golden
// fixtures and the TypeScript tests check ledgers against. The .NET API enforces the same rules
// (LedgerReader); keep them in step with contracts/openapi.json.
import { z } from "zod";
import { accountTypes, validDate } from "../domain/ledger.ts";
import { foreignAmountProblem, homeCurrencies, isCurrency, rateStatuses, validRate } from "../domain/currency.ts";

const id = z.string().min(1).max(100);
const date = z.string().refine(validDate, "Invalid calendar date");
const amount = z.number().int().nonnegative().max(99999999999);
const entry = z.object({
  id,
  title: z.string().min(1).max(100),
  kind: z.enum(["income", "expense", "investment"]),
  total: amount.positive(),
  share: amount,
  // Contract 2.2.0: how many people split an expense, the person included. Optional.
  participants: z.number().int().min(2).max(100).optional(),
  categoryId: id,
  accountId: id.optional(),
  tripId: id.optional(),
  date,
  note: z.string().max(1000),
});
const receipt = z.object({
  id,
  name: z.string().max(255),
  mime: z.string().max(100),
  uri: z.string().max(500),
});
const ledgerSchema = z
  .object({
    version: z.literal(4),
    currency: z.enum(homeCurrencies),
    accounts: z.array(z.object({ id, name: z.string().trim().min(1).max(50), type: z.enum(accountTypes) })).max(300),
    trips: z.array(z.object({ id, name: z.string().trim().min(1).max(80), startDate: date, endDate: date, sharedHouseholdId: id.optional(),
      // Contract 2.6.0 (MAZ-151 phase 2): a personal trip's currency, the default for its new entries.
      currency: z.string().refine(isCurrency, "Invalid currency").optional() })).max(300),
    categories: z
      .array(
        z.object({
          id,
          name: z.string().min(1).max(50),
          icon: z.string().max(80),
          color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
          kind: z.enum(["income", "expense", "investment"]),
        }),
      )
      .max(300),
    transactions: z
      .array(
        entry.extend({
          receipt: receipt.optional(),
          recurringId: id.optional(),
          // Contract 2.4.0 (MAZ-151): the amount in the currency it was paid in, and the rate used.
          originalAmount: amount.positive().optional(),
          originalCurrency: z.string().refine(isCurrency, "Invalid original currency").optional(),
          rate: z.string().refine(validRate, "Invalid exchange rate").optional(),
          rateStatus: z.enum(rateStatuses as [string, ...string[]]).optional(),
          rateDate: date.optional(),
        }),
      )
      .max(100000),
    recurring: z
      .array(
        entry.extend({
          frequency: z.enum(["weekly", "monthly", "yearly"]),
          nextDate: date,
          anchorDay: z.number().int().min(1).max(31),
          active: z.boolean(),
          // Rules stay in the home currency (MAZ-151 phase 1); read so a foreign rule is refused, not stripped.
          originalAmount: z.unknown().optional(),
          originalCurrency: z.unknown().optional(),
          rate: z.unknown().optional(),
          rateStatus: z.unknown().optional(),
          rateDate: z.unknown().optional(),
        }),
      )
      .max(1000),
    // Contract 2.3.0: dismissed recurring suggestions, `{kind}|{key}|{frequency}|{share}`. Optional.
    dismissedSuggestions: z.array(z.string().min(1).max(200)).max(500).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.dismissedSuggestions && new Set(data.dismissedSuggestions).size !== data.dismissedSuggestions.length)
      ctx.addIssue({ code: "custom", message: "Duplicate dismissed suggestions" });
    const accounts = new Set(data.accounts.map((a) => a.id));
    const trips = new Set(data.trips.map((trip) => trip.id));
    const categories = new Map(data.categories.map((c) => [c.id, c]));
    for (const list of [data.accounts, data.trips, data.categories, data.transactions, data.recurring])
      if (new Set(list.map((i) => i.id)).size !== list.length)
        ctx.addIssue({ code: "custom", message: "Duplicate identifiers" });
    for (const trip of data.trips)
      if (trip.endDate < trip.startDate)
        ctx.addIssue({ code: "custom", message: "Invalid trip dates" });
    for (const t of [...data.transactions, ...data.recurring]) {
      if (t.accountId && !accounts.has(t.accountId))
        ctx.addIssue({ code: "custom", message: "Invalid payment account" });
      if (t.share > t.total || (t.kind !== "expense" && t.share !== t.total))
        ctx.addIssue({ code: "custom", message: "Invalid personal share" });
      if (t.participants !== undefined && t.kind !== "expense")
        ctx.addIssue({ code: "custom", message: "Only expenses are split" });
      if (categories.get(t.categoryId)?.kind !== t.kind)
        ctx.addIssue({ code: "custom", message: "Invalid category" });
    }
    for (const t of data.transactions) {
      const problem = foreignAmountProblem(t, data.currency);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }
    for (const t of data.transactions)
      if (t.tripId && (t.kind !== "expense" || !trips.has(t.tripId)))
        ctx.addIssue({ code: "custom", message: "Invalid trip assignment" });
    for (const rule of data.recurring) {
      if (rule.tripId) ctx.addIssue({ code: "custom", message: "Recurring entries cannot belong to a trip" });
      if ([rule.originalAmount, rule.originalCurrency, rule.rate, rule.rateStatus, rule.rateDate].some((value) => value !== undefined))
        ctx.addIssue({ code: "custom", message: "Recurring entries are in the home currency" });
    }
  });

export const ledgerWriteSchema = z.object({
  revision: z.number().int().nonnegative(),
  ledger: ledgerSchema,
});
