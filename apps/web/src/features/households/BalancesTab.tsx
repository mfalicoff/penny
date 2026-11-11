import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { monthRecapQuery } from "../../api/households";
import type { MonthRecap, Transfer } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";
import { Avatar, Badge, Button, Card } from "../../design/controls";
import { Money } from "../../design/Money";
import { ErrorState, LoadingState } from "../../design/states";
import type { HouseholdView } from "./context";
import { describeLoadError } from "./errors";
import { dayLabel, monthEnd, monthLabel, monthlyPaymentsOpen } from "./model";
import { RecordMonthlyDialog } from "./PaymentDialogs";

/**
 * Balances (card `iphone-shared-balances`): each member's position for the month, the full
 * suggested payments that settle it, payments already recorded, and older months that are still
 * unpaid, each kept separate. Every number here comes from the server's month recap.
 */
export function BalancesTab({ view, recap }: { view: HouseholdView; recap: UseQueryResult<MonthRecap> }) {
  const email = useAccountEmail();
  const [recording, setRecording] = useState<{ month: string; transfer: Transfer } | null>(null);
  const overdue = (recap.data?.overdueMonths ?? []).filter((month) => month !== view.month);
  const older = useQueries({ queries: overdue.map((month) => monthRecapQuery(email, view.householdId, month)) });

  if (recap.isPending) return <LoadingState label="Loading balances…" />;
  if (!recap.data) {
    return (
      <ErrorState title="Penny couldn't load the balances" onRetry={() => void recap.refetch()} retrying={recap.isFetching}>
        {describeLoadError(recap.error)}
      </ErrorState>
    );
  }

  const record = (month: string) => (transfer: Transfer) => { setRecording({ month, transfer }); };
  return (
    <div className="page">
      <MonthCard view={view} recap={recap.data} onRecord={record(view.month)} full />
      {overdue.map((month, index) => {
        const data = older[index]?.data;
        return data ? (
          <MonthCard key={month} view={view} recap={data} onRecord={record(month)} />
        ) : (
          <Card key={month} title={monthLabel(month)} action={<Badge tone="danger">Overdue</Badge>}>
            <p className="muted">{older[index]?.isError ? "Penny couldn't load this month." : "Loading…"}</p>
          </Card>
        );
      })}
      <p className="note">Penny records payments made outside the app. It never moves money, and payments never count as spending.</p>
      {recording ? <RecordMonthlyDialog view={view} month={recording.month} transfer={recording.transfer} onClose={() => { setRecording(null); }} /> : null}
    </div>
  );
}

function MonthCard({ view, recap, onRecord, full = false }: { view: HouseholdView; recap: MonthRecap; onRecord: (transfer: Transfer) => void; full?: boolean }) {
  const open = monthlyPaymentsOpen(recap.month);
  const settled = recap.suggestions.length === 0;
  const status = recap.overdue ? (
    <Badge tone="danger" icon="alert-circle">
      Overdue
    </Badge>
  ) : settled ? (
    <Badge tone="income" icon="checkmark">
      Settled
    </Badge>
  ) : (
    <Badge tone="pending">Settles {dayLabel(monthEnd(recap.month)).replace(/^\w+, /, "")}</Badge>
  );
  const totals = new Map<string, { paid: number; share: number }>();
  for (const expense of recap.expenses) {
    const payer = totals.get(expense.payerUserId) ?? { paid: 0, share: 0 };
    payer.paid += expense.totalCents;
    totals.set(expense.payerUserId, payer);
    for (const split of expense.splits) {
      const member = totals.get(split.userId) ?? { paid: 0, share: 0 };
      member.share += split.amountCents;
      totals.set(split.userId, member);
    }
  }
  const canRecord = (transfer: Transfer) => view.canWrite && (transfer.fromUserId === view.who.meId || transfer.toUserId === view.who.meId) && open;

  return (
    <Card title={monthLabel(recap.month)} action={status}>
      {full ? (
        recap.balances.length ? (
          <ul className="row-list" aria-label={`Balances for ${monthLabel(recap.month)}`}>
            {recap.balances.map((row) => {
              const sums = totals.get(row.userId) ?? { paid: 0, share: 0 };
              return (
                <li key={row.userId} className="row">
                  <Avatar name={view.who.name(row.userId)} size={32} />
                  <span>
                    <span className="row__title">{view.who.name(row.userId)}</span>
                    <span className="row__meta" style={{ display: "block" }}>
                      Paid {view.money(sums.paid)} · share {view.money(sums.share)}
                    </span>
                  </span>
                  <span className="row__end">
                    <Money cents={row.balanceCents} currency={view.currency} tone={row.balanceCents > 0 ? "income" : "expense"} signed />
                    <span className="row__meta">{row.balanceCents > 0 ? "gets back" : row.balanceCents < 0 ? "owes" : "settled"}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">No shared expenses this month.</p>
        )
      ) : null}

      {recap.suggestions.length ? (
        <div className="shared-section">
          <h3 className="card__title">Suggested payments</h3>
          {recap.suggestions.map((transfer) => {
            const from = view.who.name(transfer.fromUserId);
            const to = view.who.name(transfer.toUserId);
            return (
              <div key={`${transfer.fromUserId}:${transfer.toUserId}`} className="transfer">
                <span className="transfer__text">
                  {from} → {to}
                </span>
                <Money cents={transfer.amountCents} currency={view.currency} />
                {canRecord(transfer) ? (
                  <Button variant="secondary" onClick={() => { onRecord(transfer); }} aria-label={`Record that ${from} paid ${to} ${view.money(transfer.amountCents)}`}>
                    Record paid
                  </Button>
                ) : null}
              </div>
            );
          })}
          {!open ? (
            <p className="note">
              Monthly payments open on the last day of the month ({dayLabel(monthEnd(recap.month))}). To repay a single expense now, open it and use Mark as paid on its share.
            </p>
          ) : null}
        </div>
      ) : full && recap.balances.length ? (
        <p className="muted">Everyone is settled for {monthLabel(recap.month)}.</p>
      ) : null}

      {full && recap.reimbursements.length ? (
        <div className="shared-section">
          <h3 className="card__title">Recorded payments</h3>
          <ul className="row-list">
            {recap.reimbursements.map((item) => (
              <li key={item.id} className="row row--plain">
                <span>
                  {view.who.name(item.fromUserId)} paid {view.who.name(item.toUserId)}
                  <span className="row__meta" style={{ display: "block" }}>
                    {item.expenseId ? "One expense share" : "Monthly payment"} · recorded by {view.who.name(item.createdBy)}
                  </span>
                </span>
                <Money cents={item.amountCents} currency={view.currency} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {!full ? (
        <Link to="/households/$id" params={{ id: view.householdId }} search={{ month: recap.month, tab: "balances" }} className="wbtn wbtn--quiet" style={{ justifySelf: "start" }}>
          Open {monthLabel(recap.month)}
        </Link>
      ) : null}
    </Card>
  );
}
