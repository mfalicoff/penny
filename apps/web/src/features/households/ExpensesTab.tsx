import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { deleteRule, householdExpensesQuery, recurringQuery, refreshHousehold, updateRule } from "../../api/households";
import type { MonthRecap, SharedExpense, SharedRecurring } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";
import { Avatar, Badge, Button, Card } from "../../design/controls";
import { Dialog } from "../../design/ModalDialog";
import { Money } from "../../design/Money";
import { EmptyState, ErrorState, LoadingState, SaveErrorBanner, useToast } from "../../design/states";
import type { HouseholdView } from "./context";
import { describeLoadError, describeSharedError } from "./errors";
import { dayLabel, monthLabel, shareOf, sharePaid, splitLabel } from "./model";
import { ExpenseLink, type GroupSearch } from "./links";

interface Props {
  view: HouseholdView;
  recap: UseQueryResult<MonthRecap>;
  search: GroupSearch;
  onEditRule: (rule: SharedRecurring) => void;
  /** Shown under the list: a shared trip's private expenses from before it was shared (MAZ-93). */
  children?: ReactNode;
}

/** Expenses (cards `iphone-shared`, `web-household`): the month's expenses, or a shared trip's whole list, then repeating expenses. */
export function ExpensesTab({ view, recap, search, onEditRule, children }: Props) {
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

  return (
    <div className="household-columns">
      <div className="page">
        {list}
        {children}
      </div>
      <RulesCard view={view} onEdit={onEditRule} />
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

const FREQUENCY: Record<SharedRecurring["frequency"], string> = { weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };

/** Repeating expenses: the server records each occurrence on its date, split among the members active then. */
function RulesCard({ view, onEdit }: { view: HouseholdView; onEdit: (rule: SharedRecurring) => void }) {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const toast = useToast();
  const rules = useQuery(recurringQuery(email, view.householdId));
  const [removing, setRemoving] = useState<SharedRecurring | null>(null);

  const toggle = useMutation({
    mutationKey: ["households", "rule", "toggle"],
    mutationFn: (rule: SharedRecurring) =>
      updateRule(view.householdId, rule.id, {
        title: rule.title,
        totalCents: rule.totalCents,
        payerUserId: rule.payerUserId,
        splitMode: rule.splitMode,
        ...(rule.allocations ? { allocations: rule.allocations } : {}),
        category: rule.category,
        note: rule.note,
        ...(rule.accountId ? { accountId: rule.accountId } : {}),
        ...(rule.receiptId ? { receiptId: rule.receiptId } : {}),
        nextDate: rule.nextDate,
        frequency: rule.frequency,
        active: !rule.active,
        revision: rule.revision,
      }),
    onSuccess: async ({ rule }) => {
      await refreshHousehold(queryClient, email, view.householdId);
      toast.show({ title: rule.active ? `${rule.title} resumed` : `${rule.title} paused` });
    },
    onError: () => void rules.refetch(),
  });

  // Rules are optional context: nothing to show (or a failed read) leaves the expense list alone.
  const list = rules.data ?? [];
  if (!list.length) return null;
  return (
    <Card title="Repeating">
      {toggle.isError ? <SaveErrorBanner message={describeSharedError(toggle.error).message} /> : null}
      <ul className="row-list" aria-label="Repeating expenses">
        {list.map((rule) => (
          <li key={rule.id} className="row row--plain">
            <span>
              <span className="row__title">{rule.title}</span>
              <span className="row__meta" style={{ display: "block" }}>
                {FREQUENCY[rule.frequency]} · {rule.active ? <>next <time dateTime={rule.nextDate}>{dayLabel(rule.nextDate, true)}</time></> : "paused"} · {view.who.name(rule.payerUserId)} pays
              </span>
              {view.canWrite ? (
                <span className="shared-actions">
                  <Button variant="quiet" onClick={() => { onEdit(rule); }} aria-label={`Edit ${rule.title}`}>
                    Edit
                  </Button>
                  <Button variant="quiet" busy={toggle.isPending} onClick={() => { toggle.mutate(rule); }} aria-label={`${rule.active ? "Pause" : "Resume"} ${rule.title}`}>
                    {rule.active ? "Pause" : "Resume"}
                  </Button>
                  <Button variant="danger-quiet" onClick={() => { setRemoving(rule); }} aria-label={`Remove ${rule.title}`}>
                    Remove
                  </Button>
                </span>
              ) : null}
            </span>
            <span className="row__end">
              <Money cents={rule.totalCents} currency={view.currency} />
              {rule.active ? null : <Badge tone="pending">Paused</Badge>}
            </span>
          </li>
        ))}
      </ul>
      <p className="note">Penny adds each occurrence on its date, split among the members active then. Past occurrences don't change.</p>
      {removing ? <RemoveRuleDialog view={view} rule={removing} onClose={() => { setRemoving(null); }} /> : null}
    </Card>
  );
}

function RemoveRuleDialog({ view, rule, onClose }: { view: HouseholdView; rule: SharedRecurring; onClose: () => void }) {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const toast = useToast();
  const remove = useMutation({
    mutationKey: ["households", "rule", "delete"],
    mutationFn: () => deleteRule(view.householdId, rule.id, rule.revision),
    onSuccess: async () => {
      await refreshHousehold(queryClient, email, view.householdId);
      toast.show({ title: `${rule.title} no longer repeats` });
      onClose();
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: recurringQuery(email, view.householdId).queryKey }),
  });
  return (
    <Dialog
      title={`Stop repeating ${rule.title}?`}
      description="Future occurrences stop for everyone. Expenses already added stay as they are."
      onClose={onClose}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" busy={remove.isPending} onClick={() => { remove.mutate(); }}>
            {remove.isPending ? "Removing…" : "Stop repeating"}
          </Button>
        </>
      }
    >
      {remove.isError ? <SaveErrorBanner message={describeSharedError(remove.error).message} /> : null}
    </Dialog>
  );
}
