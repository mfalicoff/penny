import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useId, type SyntheticEvent } from "react";
import { z } from "zod";
import { SearchResults } from "../features/search/SearchResults";

/**
 * Typed, validated search parameters for `/transactions` (legacy route kept from the
 * Expo app). Invalid values fall back instead of failing the page, so old or
 * hand-edited links still open.
 */
export const transactionsSearchSchema = z.object({
  q: z.string().trim().max(200).optional().catch(undefined),
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional()
    .catch(undefined),
});

export type TransactionsSearch = z.infer<typeof transactionsSearchSchema>;

export const Route = createFileRoute("/transactions")({
  validateSearch: transactionsSearchSchema,
  component: Transactions,
});

function Transactions() {
  const { q, month } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const inputId = useId();

  function onSubmit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("q");
    const query = typeof value === "string" && value.trim() ? value.trim() : undefined;
    void navigate({ search: (previous) => ({ ...previous, q: query }) });
  }

  return (
    <>
      <h1>Activity</h1>
      <form role="search" className="search-form" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor={inputId}>Search transactions</label>
          <input id={inputId} name="q" type="search" defaultValue={q ?? ""} key={q ?? ""} autoComplete="off" />
        </div>
        <button type="submit" className="button">
          Search
        </button>
      </form>
      <SearchResults query={q} month={month} />
    </>
  );
}
