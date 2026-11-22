import type { Ledger, Transaction } from "@domain/ledger.ts";
import type { UseQueryResult } from "@tanstack/react-query";
import type { SharedExpense } from "../../api/schemas";
import { tileStyle } from "../../design/categoryTint";
import { Card } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { formatCents, Money } from "../../design/Money";
import { EmptyState, ErrorState, LoadingState } from "../../design/states";
import { categoryIcon } from "../entries/model";
import type { HouseholdView } from "../households/context";
import { describeLoadError } from "../households/errors";
import { ExpenseLink, type GroupSearch } from "../households/links";
import { shareOf, shortDate } from "../households/model";
import { expenseCount, paidByCell, paidWords } from "./model";

interface Props {
  view: HouseholdView;
  expenses: UseQueryResult<SharedExpense[]>;
  /** Your personal expenses from before sharing ("Only you"), never sent to the trip. */
  mine: Transaction[];
  ledger: Ledger | null;
  search: GroupSearch;
  onOpenPrivate: (entry: Transaction) => void;
  /**
   * From 1100px (card `ipad-trip`): one Expenses panel, "4 shared · 1 private", with the private
   * rows inline. Narrower (card `iphone-trip-detail`): SHARED WITH EVERYONE and its count over the
   * shared rows, then a lock-labelled ONLY YOU "from before sharing" over the private ones.
   */
  combined: boolean;
  /**
   * On the desktop (card `web-trip`): a Shared with everyone table (expense and date, paid by,
   * total, your share), then Only you, with your private expenses and what they count in.
   */
  tables?: boolean;
}

/**
 * A shared trip's expenses (cards `iphone-trip-detail`, `ipad-trip`): each row has the category
 * tile, the title, "Oct 2 · Sam paid · split 4 ways", the total and your part ("$206.00 yours").
 * The whole trip is listed, oldest first, whatever the month; balances still settle month by month.
 */
export function TripExpenses({ view, expenses, mine, ledger, search, onOpenPrivate, combined, tables }: Props) {
  if (expenses.isPending) return <LoadingState label="Loading expenses…" />;
  if (!expenses.data) {
    return (
      <ErrorState title="Penny couldn't load the expenses" onRetry={() => void expenses.refetch()} retrying={expenses.isFetching}>
        {describeLoadError(expenses.error)}
      </ErrorState>
    );
  }
  // Oldest first, as the cards list a trip: bookings before the trip, then the days of it.
  const byDate = <T extends { date: string; id: string }>(rows: readonly T[]) => [...rows].sort((x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id));
  const shared = byDate(expenses.data);
  const privateRows = ledger ? byDate(mine) : [];
  const empty = (
    <EmptyState icon="receipt" title="No trip expenses yet">
      <p>{view.canWrite ? "Add one with Trip expense. Everyone sees the full total; your reports count only your share." : "Nothing was shared with you here."}</p>
    </EmptyState>
  );

  if (tables) {
    if (!shared.length && !privateRows.length) return empty;
    return (
      <div className="page trip-tables">
        {shared.length ? <SharedTable view={view} expenses={shared} search={search} /> : null}
        {ledger && privateRows.length ? <PrivateTable entries={privateRows} ledger={ledger} onOpen={onOpenPrivate} /> : null}
      </div>
    );
  }

  if (combined) {
    if (!shared.length && !privateRows.length) return empty;
    const counts = [`${String(shared.length)} shared`, ...(privateRows.length ? [`${String(privateRows.length)} private`] : [])].join(" · ");
    return (
      <Card title="Expenses" action={<span className="muted">{counts}</span>} className="trip-expenses">
        <ul className="trip-expenses__rows" aria-label="Trip expenses">
          {shared.map((expense) => (
            <li key={expense.id}>
              <SharedRow expense={expense} view={view} search={search} />
            </li>
          ))}
          {ledger
            ? privateRows.map((entry) => (
                <li key={entry.id}>
                  <PrivateRow entry={entry} ledger={ledger} inline onOpen={() => { onOpenPrivate(entry); }} />
                </li>
              ))
            : null}
        </ul>
      </Card>
    );
  }

  return (
    <div className="page">
      {shared.length ? (
        <section className="shared-group" aria-labelledby="trip-shared-heading">
          <div className="shared-group__head">
            <h2 id="trip-shared-heading">Shared with everyone</h2>
            <span>{expenseCount(shared.length)}</span>
          </div>
          <ul className="shared-group__rows" aria-label="Shared expenses">
            {shared.map((expense) => (
              <li key={expense.id}>
                <SharedRow expense={expense} view={view} search={search} />
              </li>
            ))}
          </ul>
        </section>
      ) : (
        empty
      )}
      {ledger && privateRows.length ? (
        <section className="shared-group" aria-labelledby="trip-private-heading">
          <div className="shared-group__head">
            <h2 id="trip-private-heading" className="trip-expenses__private-label">
              <Icon name="lock-closed" size={14} />
              Only you
            </h2>
            <span>from before sharing</span>
          </div>
          <ul className="shared-group__rows" aria-label="Private expenses">
            {privateRows.map((entry) => (
              <li key={entry.id}>
                <PrivateRow entry={entry} ledger={ledger} onOpen={() => { onOpenPrivate(entry); }} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** `web-trip`'s Shared with everyone: the expense with its date, who paid, the total and your share. */
function SharedTable({ view, expenses, search }: { view: HouseholdView; expenses: SharedExpense[]; search: GroupSearch }) {
  const me = view.who.meId;
  return (
    <section className="card expense-table trip-table" aria-labelledby="trip-shared-heading">
      <div className="trip-table__head">
        <h2 id="trip-shared-heading">Shared with everyone</h2>
        <span>{expenseCount(expenses.length)}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th scope="col">Expense</th>
            <th scope="col">Paid by</th>
            <th scope="col" className="num">
              Total
            </th>
            <th scope="col" className="num">
              Your share
            </th>
          </tr>
        </thead>
        <tbody>
          {expenses.map((expense) => {
            const yours = shareOf(expense, me);
            return (
              <tr key={expense.id}>
                <th scope="row">
                  <ExpenseLink route={view.route} householdId={view.householdId} expenseId={expense.id} search={search} className="expense-table__title">
                    <span className="category-dot" style={tileStyle(expense.category)} aria-hidden="true">
                      <Icon name={categoryIcon(expense.category.icon)} size={18} />
                    </span>
                    <span className="trip-table__name">
                      <span>{expense.title}</span>
                      <time dateTime={expense.date}>{shortDate(expense.date)}</time>
                    </span>
                  </ExpenseLink>
                </th>
                <td className="muted">{paidByCell(expense, me, view.who.name(expense.payerUserId))}</td>
                <td className="num">
                  <Money cents={expense.totalCents} currency={view.currency} />
                </td>
                <td className="num">
                  {yours > 0 ? (
                    view.money(yours)
                  ) : (
                    <>
                      <span aria-hidden="true">—</span>
                      <span className="visually-hidden">Not part of your share</span>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** `web-trip`'s Only you: your private trip expenses, "Sep 28 · Visa", and what they count in. */
function PrivateTable({ entries, ledger, onOpen }: { entries: Transaction[]; ledger: Ledger; onOpen: (entry: Transaction) => void }) {
  return (
    <section className="card expense-table trip-table" aria-labelledby="trip-private-heading">
      <div className="trip-table__head">
        <h2 id="trip-private-heading">
          <Icon name="lock-closed" size={14} />
          Only you
        </h2>
        <span>{expenseCount(entries.length)}</span>
      </div>
      <table>
        <tbody>
          {entries.map((entry) => {
            const category = ledger.categories.find((item) => item.id === entry.categoryId);
            const account = entry.accountId ? ledger.accounts.find((item) => item.id === entry.accountId) : undefined;
            return (
              <tr key={entry.id}>
                <th scope="row">
                  <button type="button" className="expense-table__title trip-table__open" onClick={() => { onOpen(entry); }}>
                    <span className="category-dot" style={tileStyle(category)} aria-hidden="true">
                      <Icon name={categoryIcon(category?.icon)} size={18} />
                    </span>
                    <span className="trip-table__name">
                      <span>{entry.title}</span>
                      <span>
                        <time dateTime={entry.date}>{shortDate(entry.date)}</time>
                        {account ? ` · ${account.name}` : ""}
                      </span>
                    </span>
                  </button>
                </th>
                <td className="num">
                  <Money cents={entry.share} currency={ledger.currency} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="note trip-table__note">Only you see these. They count in your spending, not in the trip's total or anyone's balance.</p>
    </section>
  );
}

function SharedRow({ expense, view, search }: { expense: SharedExpense; view: HouseholdView; search: GroupSearch }) {
  const me = view.who.meId;
  const yours = shareOf(expense, me);
  return (
    <ExpenseLink route={view.route} householdId={view.householdId} expenseId={expense.id} search={search} className="row trip-expense-row">
      <span className="category-dot" style={tileStyle(expense.category)} aria-hidden="true">
        <Icon name={categoryIcon(expense.category.icon)} size={18} />
      </span>
      <span className="row__main">
        <span className="row__title">{expense.title}</span>
        <span className="row__meta">
          <time dateTime={expense.date}>{shortDate(expense.date)}</time> · {paidWords(expense, me, view.who.name(expense.payerUserId))}
        </span>
      </span>
      <span className="row__end">
        <Money cents={expense.totalCents} currency={view.currency} />
        <span className="row__meta">{yours > 0 ? `${view.money(yours)} yours` : "Not part of your share"}</span>
      </span>
    </ExpenseLink>
  );
}

/**
 * One of your private trip expenses: "Sep 28 · Visa" under its own list (`iphone-trip-detail`), or
 * inline with the lock and "Only you · Sep 28" (`ipad-trip`). Only your share shows.
 */
function PrivateRow({ entry, ledger, inline, onOpen }: { entry: Transaction; ledger: Ledger; inline?: boolean; onOpen: () => void }) {
  const category = ledger.categories.find((item) => item.id === entry.categoryId);
  const account = entry.accountId ? ledger.accounts.find((item) => item.id === entry.accountId) : undefined;
  const date = <time dateTime={entry.date}>{shortDate(entry.date)}</time>;
  return (
    <button type="button" className="row trip-expense-row" onClick={onOpen}>
      <span className="category-dot" style={tileStyle(category)} aria-hidden="true">
        <Icon name={categoryIcon(category?.icon)} size={18} />
      </span>
      <span className="row__main">
        <span className="row__title">{entry.title}</span>
        {inline ? (
          <span className="row__meta trip-expenses__private-meta">
            <Icon name="lock-closed" size={13} />
            Only you · {date}
          </span>
        ) : (
          <span className="row__meta">
            {date} · {account?.name ?? category?.name ?? "Unknown category"}
          </span>
        )}
      </span>
      <span className="row__end">
        <Money cents={entry.share} currency={ledger.currency} />
        {entry.share !== entry.total ? <span className="row__meta">of {formatCents(entry.total, ledger.currency)}</span> : null}
      </span>
    </button>
  );
}
