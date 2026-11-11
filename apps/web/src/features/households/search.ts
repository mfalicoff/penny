import { z } from "zod";

export const HOUSEHOLD_TABS = ["expenses", "balances", "people", "history"] as const;
export type HouseholdTab = (typeof HOUSEHOLD_TABS)[number];

/**
 * Search parameters of `/households/$id` and its expense URL. `month` and `tab` make a view
 * bookmarkable; `add=1` (a legacy deep link) opens the new-expense form once. Bad values fall
 * back, so old or hand-edited links still open.
 */
export const householdSearchSchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional()
    .catch(undefined),
  tab: z.enum(HOUSEHOLD_TABS).optional().catch(undefined),
  add: z.union([z.literal(1), z.literal("1")]).optional().catch(undefined),
});

export type HouseholdSearch = z.infer<typeof householdSearchSchema>;
