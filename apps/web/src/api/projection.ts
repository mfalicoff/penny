import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { apiFetch } from "./client";
import { householdsKey } from "./households";
import { projectedExpenseSchema } from "./schemas";

/**
 * `GET /api/households/projection` (MAZ-57): the signed-in person's share of every shared expense
 * across their households, for a month or a year (or everything, with no filter). Activity (MAZ-88)
 * lists these rows next to personal entries and adds the shares to the period's spending.
 *
 * The key sits under the account's household list key, so every shared write that calls
 * `refreshHousehold` or `forgetHousehold` also refreshes it. Shared data is online-only: the cached
 * copy is shown offline, labelled as such, and is never written to the durable offline store.
 */
export type ProjectionPeriod = { month: string } | { year: string } | Record<string, never>;

const projectionSchema = z.object({
  transactions: z.array(projectedExpenseSchema),
  scheduled: z.array(projectedExpenseSchema),
});

export type SharedProjection = z.infer<typeof projectionSchema>;
export type SharedRow = SharedProjection["transactions"][number];

function periodQuery(period: ProjectionPeriod): string {
  if ("month" in period) return `?month=${encodeURIComponent(period.month)}`;
  if ("year" in period) return `?year=${encodeURIComponent(period.year)}`;
  return "";
}

export const sharedProjectionQuery = (email: string, period: ProjectionPeriod) =>
  queryOptions({
    queryKey: [...householdsKey(email), "projection", periodQuery(period) || "all"],
    queryFn: ({ signal }) => apiFetch(`/api/households/projection${periodQuery(period)}`, projectionSchema, { signal }),
    staleTime: 30_000,
  });
