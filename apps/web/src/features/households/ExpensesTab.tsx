import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { recurringQuery } from "../../api/households";
import type { MonthRecap, SharedExpense, SharedRecurring } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";
import { TOUCH_TABLET, useMediaQuery } from "../../app/useMediaQuery";
import { tileStyle } from "../../design/categoryTint";
import { Avatar, Badge } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { Money } from "../../design/Money";
import { EmptyState, ErrorState, LoadingState } from "../../design/states";
import { categoryIcon } from "../entries/model";
import type { HouseholdView } from "./context";
import { describeLoadError } from "./errors";
import { monthEnd, monthLabel, shareOf, sharePaid, shortDate } from "./model";
import { ExpenseLink, type GroupSearch } from "./links";

interface Props {
  view: HouseholdView;
  recap: UseQueryResult<MonthRecap>;
  search: GroupSearch;
  /**
   * The side pane from 1100px (cards `ipad-shared`, `web-household`): the selected expense and
   * Balances. With it, the expenses are the `web-household` table. Repeating expenses open from
   * the expenses they add (MAZ-229).
   */
  side?: ReactNode;
}

const FREQUENCY: Record<SharedRecurring["frequency"], string> = { weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };

/**
 * Expenses (cards `iphone-shared`, `web-household`, `ipad-shared`): the month's expenses (a
 * shared trip's are `TripExpenses`). Phones and tablets list them under the month and its total, each with
 * the payer's avatar, "<payer> paid · split equally" and the viewer's position; from 1100px a
 * household shows them as a table with the payer, split, total, your share and status.
 */
export function ExpensesTab({ view, recap, search, side }: Props) {
  const email = useAccountEmail();
  // The table is the desktop's (`web-household`); a touch tablet keeps the card's list (`ipad-shared`).
  const tablet = useMediaQuery(TOUCH_TABLET);
  const table = Boolean(side) && !tablet;
  const rules = useQuery({ ...recurringQuery(email, view.householdId), enabled: table });
  const source = recap;
  const expenses = recap.data?.expenses;
  const heading = monthLabel(view.month).split(" ")[0] ?? view.month;

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
      <EmptyState icon="receipt" title={`No shared expenses in ${monthLabel(view.month)}`}>
        <p>{view.canWrite ? `Add one with Expense. Everyone sees the full total; your reports count only your share.` : "Nothing was shared with you here."}</p>
      </EmptyState>
    );
  } else if (table) {
    list = <ExpenseTable view={view} expenses={expenses} search={search} rules={rules.data} />;
  } else {
    const total = expenses.reduce((sum, expense) => sum + expense.totalCents, 0);
    list = (
      <section className="shared-group" aria-labelledby="expenses-heading">
        <div className="shared-group__head">
          <h2 id="expenses-heading">{heading}</h2>
          <span>{view.money(total)} total</span>
        </div>
        <ul className="shared-group__rows" aria-label="Expenses">
          {expenses.map((expense) => (
            <li key={expense.id}>
              <ExpenseLink route={view.route} householdId={view.householdId} expenseId={expense.id} search={search} className="row">
                <Avatar name={view.who.avatar(expense.payerUserId)} size={36} />
                <span className="row__main">
                  <span className="row__title">{expense.title}</span>
                  <span className="row__meta">
                    {view.who.name(expense.payerUserId)} paid · {splitWords(expense)}
                  </span>
                  {settledForMe(expense, view) ? (
                    <Badge tone="income" icon="checkmark">
                      Settled
                    </Badge>
                  ) : null}
                </span>
                <ExpenseAmounts expense={expense} view={view} />
              </ExpenseLink>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  if (!side) {
    return (
      <div className="page">
        {list}
      </div>
    );
  }
  return (
    <div className="household-columns">
      <div className="page">{list}</div>
      <div className="page">{side}</div>
    </div>
  );
}

/** "split equally", "split by amount", "split by percent", in the cards' words. */
function splitWords(expense: Pick<SharedExpense, "splitMode">): string {
  return expense.splitMode === "equal" ? "split equally" : expense.splitMode === "exact" ? "split by amount" : "split by percent";
}

/** The viewer had a share they've repaid: the card's green Settled pill under the row. */
function settledForMe(expense: SharedExpense, view: HouseholdView): boolean {
  const me = view.who.meId;
  return me !== undefined && expense.payerUserId !== me && shareOf(expense, me) > 0 && sharePaid(expense, me);
}

/** Total plus the viewer's position on it, in words as well as color. */
function ExpenseAmounts({ expense, view }: { expense: SharedExpense; view: HouseholdView }) {
  const me = view.who.meId;
  const mine = shareOf(expense, me);
  let position;
  if (me && expense.payerUserId === me) {
    const owed = expense.splits.filter((split) => split.userId !== me && !sharePaid(expense, split.userId)).reduce((sum, split) => sum + split.amountCents, 0);
    position = owed > 0 ? <span className="row__meta">+{view.money(owed)} owed</span> : <span className="row__meta">Everyone repaid you</span>;
  } else if (me && mine > 0) {
    position = sharePaid(expense, me) ? (
      <span className="row__meta">{view.money(mine)} your share</span>
    ) : (
      <span className="row__meta">−{view.money(mine)} you owe</span>
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

/**
 * The `web-household` table: EXPENSE (category tile, title, the repeat's frequency), PAID BY,
 * SPLIT, TOTAL, YOUR SHARE and STATUS. The title links to the expense, which opens beside it.
 */
function ExpenseTable({ view, expenses, search, rules }: { view: HouseholdView; expenses: SharedExpense[]; search: GroupSearch; rules: SharedRecurring[] | undefined }) {
  const me = view.who.meId;
  return (
    <section className="card expense-table" aria-label={`Expenses in ${monthLabel(view.month)}`}>
      <table>
        <thead>
          <tr>
            <th scope="col">Expense</th>
            <th scope="col">Paid by</th>
            <th scope="col">Split</th>
            <th scope="col" className="num">
              Total
            </th>
            <th scope="col" className="num">
              Your share
            </th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {expenses.map((expense) => {
            const rule = expense.recurringId ? rules?.find((item) => item.id === expense.recurringId) : undefined;
            const mine = shareOf(expense, me);
            return (
              <tr key={expense.id}>
                <th scope="row">
                  <ExpenseLink route={view.route} householdId={view.householdId} expenseId={expense.id} search={search} className="expense-table__title">
                    <span className="category-dot" style={tileStyle(expense.category)} aria-hidden="true">
                      <Icon name={categoryIcon(expense.category.icon)} size={18} />
                    </span>
                    <span>{expense.title}</span>
                  </ExpenseLink>
                  {expense.recurringId ? (
                    <span className="expense-table__repeat">
                      <Icon name="repeat" size={13} />
                      {rule ? FREQUENCY[rule.frequency] : "Repeats"}
                    </span>
                  ) : null}
                </th>
                <td>
                  <span className="expense-table__payer">
                    <Avatar name={view.who.avatar(expense.payerUserId)} size={22} />
                    {view.who.name(expense.payerUserId)}
                  </span>
                </td>
                <td className="muted">{expense.splitMode === "equal" ? "Equally" : expense.splitMode === "exact" ? "By amount" : "By percent"}</td>
                <td className="num">
                  <Money cents={expense.totalCents} currency={view.currency} />
                </td>
                <td className="num">{mine > 0 ? view.money(mine) : "—"}</td>
                <td>
                  <ExpenseStatus expense={expense} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** Paid once every share is repaid; otherwise it settles with the month. */
function ExpenseStatus({ expense }: { expense: SharedExpense }) {
  const owing = expense.splits.filter((split) => split.userId !== expense.payerUserId && split.amountCents > 0);
  if (owing.length > 0 && owing.every((split) => sharePaid(expense, split.userId))) {
    return (
      <Badge tone="income" icon="checkmark">
        Paid
      </Badge>
    );
  }
  return <Badge tone="pending">Settles {shortDate(monthEnd(expense.date.slice(0, 7)))}</Badge>;
}

