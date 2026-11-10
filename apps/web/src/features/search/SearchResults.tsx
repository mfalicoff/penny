import { useInfiniteQuery } from "@tanstack/react-query";
import { ApiError } from "../../api/client";
import { monthRange, searchTransactionsQuery } from "../../api/search";
import type { SearchItem } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";

function describeSearchError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return "This server doesn't offer full search yet. Showing nothing rather than guessing.";
    if (error.status === 429) return "Too many searches. Wait a minute and try again.";
    if (error.status === 503) return "Search is busy. Try again in a moment.";
    if (error.status === 0) return "Penny can't reach the server.";
    if (error.status >= 500) return "Search failed on the server. Try again in a moment.";
    return error.message;
  }
  return "Search failed.";
}

/** Amounts are integer cents from the API; personal entries use the ledger currency (CAD until MAZ-86's money module lands). */
function formatCents(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100);
}

function describe(item: SearchItem) {
  if (item.source === "personal") {
    return { title: item.entry.title, date: item.entry.date, amount: formatCents(item.entry.share, "CAD"), origin: "Personal" };
  }
  return {
    title: item.entry.title,
    date: item.entry.date,
    amount: formatCents(item.entry.shareCents, item.entry.householdCurrency ?? "CAD"),
    origin: item.entry.householdName ? `Shared · ${item.entry.householdName}` : "Shared",
  };
}

export function SearchResults({ query, month }: { query: string | undefined; month: string | undefined }) {
  const email = useAccountEmail();
  const search = useInfiniteQuery(searchTransactionsQuery(email, { ...(query ? { query } : {}), ...monthRange(month) }));

  if (search.isPending) {
    return (
      <p role="status" aria-live="polite">
        Searching…
      </p>
    );
  }
  if (search.isError) {
    return (
      <div role="alert">
        <p>{describeSearchError(search.error)}</p>
        <button
          type="button"
          className="button"
          onClick={() => {
            void search.refetch();
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  const items = search.data.pages.flatMap((page) => page.items);
  const total = search.data.pages[0]?.totalCount ?? 0;
  return (
    <section aria-label="Search results">
      <p role="status" aria-live="polite">
        {total === 0 ? "No matching transactions." : `${total} matching transaction${total === 1 ? "" : "s"}`}
      </p>
      <ul className="results">
        {items.map((item) => {
          const row = describe(item);
          return (
            <li key={item.key} className="results__row">
              <span className="results__title">{row.title}</span>
              <span className="results__meta">
                {row.origin} · <time dateTime={row.date}>{row.date}</time>
              </span>
              <span className="results__amount pk-num">{row.amount}</span>
            </li>
          );
        })}
      </ul>
      {search.hasNextPage ? (
        <button
          type="button"
          className="button button--secondary"
          aria-disabled={search.isFetchingNextPage}
          onClick={() => {
            if (!search.isFetchingNextPage) void search.fetchNextPage();
          }}
        >
          {search.isFetchingNextPage ? "Loading…" : "Show more"}
        </button>
      ) : null}
    </section>
  );
}
