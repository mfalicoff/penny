import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { householdExpensesQuery } from "../../api/households";
import type { MonthRecap, SharedExpense } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";
import { Avatar, Badge, Card } from "../../design/controls";
import { Money } from "../../design/Money";
import { EmptyState, ErrorState, LoadingState } from "../../design/states";
import type { HouseholdView } from "./context";
import { describeLoadError } from "./errors";
import { dayLabel, monthLabel, shareOf, sharePaid, splitLabel } from "./model";
import { ExpenseLink, type GroupSearch } from "./links";

interface Props {
  view: HouseholdView;
  recap: UseQueryResult<MonthRecap>;
  search: GroupSearch;
  /** Shown under the list: a shared trip's private expenses from before it was shared (MAZ-93). */
  children?: ReactNode;
  /**
   * The side pane from 1100px (cards `ipad-shared`, `web-household`): the selected expense and
   * Balances. Repeating expenses open from the expenses they add (MAZ-229).
   */
  side?: ReactNode;
}

/** Expenses (cards `iphone-shared`, `web-household`, `ipad-shared`): the month's expenses, or a shared trip's whole list. */
export function ExpensesTab({ view, recap, search, children, side }: Props) {
  const email = useAccountEmail();
  const trip = Boolean(view.detail.household.trip);
  const tripExpenses = useQuery({ ...householdExpensesQuery(email, view.householdId), enabled: trip });
  const source = trip ? tripExpenses : recap;
  const expenses = trip ? tripExpenses.data : recap.data?.expenses;

  let list;
  if (source.isPending) list = <LoadingState label="Loading expenses…" />;
  else if (!expenses) {
    list = (
      <ErrorState title="Penny couldn't load the expenses" onRetry={() => void source.refetch()} retrying={source.isFetching}>
        {describeLoadError(source.error)}
      </ErrorState>
    );
  } else if (!expenses.length) {
    list = (
      <EmptyState icon="receipt" title={trip ? "No trip expenses yet" : `No shared expenses in ${monthLabel(view.month)}`}>
        <p>{view.canWrite ? `Add one with ${view.route === "trips" ? "Trip" : "Shared"} expense. Everyone sees the full total; your reports count only your share.` : "Nothing was shared with you here."}</p>
      </EmptyState>
    );
  } else {
    const total = expenses.reduce((sum, expense) => sum + expense.totalCents, 0);
    list = (
      <Card title={trip ? "Shared with everyone" : monthLabel(view.month)} action={<span className="muted">{view.money(total)} total</span>}>
        <ul className="row-list" aria-label="Expenses">
          {expenses.map((expense) => (
            <li key={expense.id}>
              <ExpenseLink route={view.route} householdId={view.householdId} expenseId={expense.id} search={search} className="row">
                <Avatar name={view.who.name(expense.payerUserId) === "You" ? email : view.who.name(expense.payerUserId)} size={32} />
                <span>
                  <span className="row__title">{expense.title}</span>
                  <span className="row__meta" style={{ display: "block" }}>
                    {view.who.name(expense.payerUserId)} paid · {splitLabel(expense).toLowerCase()} · <time dateTime={expense.date}>{dayLabel(expense.date)}</time>
                    {expense.recurringId ? " · repeats" : ""}
                  </span>
                </span>
                <ExpenseAmounts expense={expense} view={view} />
              </ExpenseLink>
            </li>
          ))}
        </ul>
      </Card>
    );
  }

  if (!side) {
    return (
      <div className="page">
        {list}
        {children}
      </div>
    );
  }
  return (
    <div className="household-columns">
      <div className="page">
        {list}
        {children}
      </div>
      <div className="page">{side}</div>
    </div>
  );
}

/** Total plus the viewer's position on it, in words as well as color. */
function ExpenseAmounts({ expense, view }: { expense: SharedExpense; view: HouseholdView }) {
  const me = view.who.meId;
  const mine = shareOf(expense, me);
  let position;
  if (me && expense.payerUserId === me) {
    const owed = expense.splits.filter((split) => split.userId !== me && !sharePaid(expense, split.userId)).reduce((sum, split) => sum + split.amountCents, 0);
    position = owed > 0 ? (
      <span className="row__meta">
        <Money cents={owed} currency={view.currency} tone="income" /> owed to you
      </span>
    ) : (
      <Badge tone="income" icon="checkmark">
        Settled
      </Badge>
    );
  } else if (me && mine > 0) {
    position = sharePaid(expense, me) ? (
      <span className="row__meta">
        <Badge tone="income" icon="checkmark">
          Repaid
        </Badge>{" "}
        {view.money(mine)} your share
      </span>
    ) : (
      <span className="row__meta">{view.money(mine)} your share</span>
    );
  } else {
    position = <span className="row__meta">Not part of your share</span>;
  }
  return (
    <span className="row__end">
      <Money cents={expense.totalCents} currency={view.currency} />
      {position}
    </span>
  );
}
