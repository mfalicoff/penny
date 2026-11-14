import { z } from "zod";
import { householdSearchSchema } from "../households/search";

/**
 * Search parameters of `/trips/$id`. A shared trip uses the household's `month` and `tab`, plus
 * `expense` for the expense open in the detail panel and `add=1` (Add expense on the Trips list),
 * which opens the new-expense form once; a personal trip ignores them. Bad values fall back, so
 * old or hand-edited links still open.
 */
export const tripSearchSchema = householdSearchSchema.extend({
  add: z.union([z.literal(1), z.literal("1")]).optional().catch(undefined),
  expense: z.string().min(1).max(200).optional().catch(undefined),
});

export type TripSearch = z.infer<typeof tripSearchSchema>;
