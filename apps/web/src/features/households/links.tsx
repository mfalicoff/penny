import { Link } from "@tanstack/react-router";
import type { CSSProperties, ReactNode } from "react";
import type { HouseholdRoute } from "./context";
import type { HouseholdSearch } from "./search";

/** A household or shared-trip page's search state; `expense` opens one expense on a shared trip. */
export type GroupSearch = HouseholdSearch & { expense?: string | undefined };

interface GroupLinkProps {
  route: HouseholdRoute;
  householdId: string;
  search: GroupSearch;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  "aria-label"?: string;
  "aria-current"?: "page" | undefined;
  exact?: boolean;
}

/**
 * A link to a section or month of the same group, under the URL it was opened from: a household
 * stays on `/households/$id`, a shared trip on `/trips/$id` (MAZ-93). Shared trips keep `expense`
 * in their search; households have their own expense URL ({@link ExpenseLink}).
 */
export function GroupLink({ route, householdId, search, exact, children, ...rest }: GroupLinkProps) {
  const active = exact ? { activeOptions: { exact: true, includeSearch: true } } : {};
  if (route === "trips") {
    return (
      <Link to="/trips/$id" params={{ id: householdId }} search={search} {...active} {...rest}>
        {children}
      </Link>
    );
  }
  const household = householdOnly(search);
  return (
    <Link to="/households/$id" params={{ id: householdId }} search={household} {...active} {...rest}>
      {children}
    </Link>
  );
}

/** One expense's detail: `/households/$id/expenses/$expenseId`, or `?expense=` on a shared trip. */
export function ExpenseLink({ route, householdId, expenseId, search, className, children }: Omit<GroupLinkProps, "exact"> & { expenseId: string }) {
  if (route === "trips") {
    return (
      <Link to="/trips/$id" params={{ id: householdId }} search={{ ...search, expense: expenseId }} className={className}>
        {children}
      </Link>
    );
  }
  const household = householdOnly(search);
  return (
    <Link to="/households/$id/expenses/$expenseId" params={{ id: householdId, expenseId }} search={household} className={className}>
      {children}
    </Link>
  );
}

/** A household's own search: everything but the shared-trip-only `expense`. */
function householdOnly({ month, tab }: GroupSearch): HouseholdSearch {
  return { ...(month ? { month } : {}), ...(tab ? { tab } : {}) };
}

/** Where to go after leaving, removal of oneself or archiving. */
export const groupListPath = (route: HouseholdRoute) => (route === "trips" ? ("/trips" as const) : ("/households" as const));
