import { z } from "zod";
import { upgradeLedger, validDate } from "../../src/domain/ledger.ts";

const id = z.string().min(1).max(100);
const date = z.string().refine(validDate, "Invalid calendar date");
const amount = z.number().int().nonnegative().max(99999999999);
const entry = z.object({
  id,
  title: z.string().min(1).max(100),
  kind: z.enum(["income", "expense", "investment"]),
  total: amount.positive(),
  share: amount,
  categoryId: id,
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
    version: z.union([z.literal(1), z.literal(2)]),
    currency: z.enum(["CAD", "USD", "EUR", "GBP"]),
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
        }),
      )
      .max(1000),
  })
  .superRefine((data, ctx) => {
    const categories = new Map(data.categories.map((c) => [c.id, c]));
    for (const list of [data.categories, data.transactions, data.recurring])
      if (new Set(list.map((i) => i.id)).size !== list.length)
        ctx.addIssue({ code: "custom", message: "Duplicate identifiers" });
    for (const t of [...data.transactions, ...data.recurring]) {
      if (t.share > t.total || (t.kind !== "expense" && t.share !== t.total))
        ctx.addIssue({ code: "custom", message: "Invalid personal share" });
      if (categories.get(t.categoryId)?.kind !== t.kind)
        ctx.addIssue({ code: "custom", message: "Invalid category" });
    }
  }).transform(upgradeLedger);

export const ledgerWriteSchema = z.object({
  revision: z.number().int().nonnegative(),
  ledger: ledgerSchema,
});
