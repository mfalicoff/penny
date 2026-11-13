import { z } from "zod";
import { householdSearchSchema } from "../households/search";

/**
 * Search parameters of `/trips/$id`. A shared trip uses the household's `month`, `tab` and legacy
 * `add=1`, plus `expense` for the expense open in the detail panel; a personal trip ignores them.
 * Bad values fall back, so old or hand-edited links still open.
 */
export const tripSearchSchema = householdSearchSchema.extend({
  expense: z.string().min(1).max(200).optional().catch(undefined),
});

export type TripSearch = z.infer<typeof tripSearchSchema>;
