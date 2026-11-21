import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { useId, useState, type ReactNode } from "react";
import { monthRecapQuery } from "../../api/households";
import type { MonthRecap, Transfer } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";
import { Avatar, Badge, Card, cx } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { Money } from "../../design/Money";
import { ErrorState, LoadingState } from "../../design/states";
import type { HouseholdView } from "./context";
import { describeLoadError } from "./errors";
import { monthEnd, monthLabel, monthlyPaymentsOpen, shortDate } from "./model";
import { RecordMonthlyDialog } from "./PaymentDialogs";

const NO_MONEY_NOTE = "Penny records payments made outside the app. It never moves money, and payments never count as spending.";

/**
 * Balances (cards `iphone-shared-balances`, `web-household`): each member's position for the
 * month, the full suggested payments that settle it, payments already recorded, and older months
 * that are still unpaid, each kept separate. Every number here comes from the server's month
 * recap. On phones and tablets each part is a labelled list; `compact` is the `web-household`
 * side pane: a Balances card and a card per overdue month.
 */
export function BalancesTab({ view, recap, compact = false }: { view: HouseholdView; recap: UseQueryResult<MonthRecap>; compact?: boolean }) {
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
  const olderMonths = overdue.map((month, index) => {
    const data = older[index]?.data;
    const last = index === overdue.length - 1;
    if (data) return <OverdueMonth key={month} view={view} recap={data} onRecord={record(month)} compact={compact} note={compact && last} />;
    return (
      <Section key={month} compact={compact} title={monthName(month)} status={<StatusTag tone="danger" icon="alert-circle" label="Overdue" />}>
        <p className="muted">{older[index]?.isError ? "Penny couldn't load this month." : "Loading…"}</p>
      </Section>
    );
  });

  return (
    <div className="page balances">
      <CurrentMonth view={view} recap={recap.data} onRecord={record(view.month)} compact={compact} note={compact && overdue.length === 0} />
      {olderMonths}
      {recording ? <RecordMonthlyDialog view={view} month={recording.month} transfer={recording.transfer} onClose={() => { setRecording(null); }} /> : null}
    </div>
  );
}

/** "November", or "November 2025" when it isn't this year's. */
function monthName(month: string): string {
  const label = monthLabel(month);
  return month.slice(0, 4) === new Date().toISOString().slice(0, 4) ? (label.split(" ")[0] ?? label) : label;
}

/** The month's status beside its label: Overdue in red, Settled in green, otherwise when it settles (amber, with a clock). */
function monthStatus(recap: MonthRecap) {
  if (recap.overdue) return <StatusTag tone="danger" icon="alert-circle" label="Overdue" />;
  if (recap.suggestions.length === 0) return <StatusTag tone="income" icon="checkmark" label="Settled" />;
  return <StatusTag tone="pending" icon="time" label={`Settles ${shortDate(monthEnd(recap.month))}`} />;
}

function StatusTag({ tone, icon, label }: { tone: "danger" | "income" | "pending"; icon: "alert-circle" | "checkmark" | "time"; label: string }) {
  return (
    <Badge tone={tone} icon={icon}>
      {label}
    </Badge>
  );
}

/**
 * A labelled part of Balances: on phones the uppercase label (and status) above a list card, as
 * on `iphone-shared-balances`; compact, a card titled with it, as on `web-household`.
 */
function Section({ title, status, compact, children }: { title: string; status?: ReactNode; compact: boolean; children: ReactNode }) {
  const id = useId();
  if (compact) {
    return (
      <Card title={title} action={status} className="balances-card">
        {children}
      </Card>
    );
  }
  return (
    <section className="shared-group" aria-labelledby={id}>
      <div className="shared-group__head">
        <h2 id={id}>{title}</h2>
        {status}
      </div>
      {children}
    </section>
  );
}

/** `note`: the side pane's last card ends with what recording a payment means (`web-household`). */
function CurrentMonth({ view, recap, onRecord, compact, note }: { view: HouseholdView; recap: MonthRecap; onRecord: (transfer: Transfer) => void; compact: boolean; note: boolean }) {
  const totals = new Map<string, { paid: number; share: number; repaid: number }>();
  const sums = (userId: string) => {
    let found = totals.get(userId);
    if (!found) {
      found = { paid: 0, share: 0, repaid: 0 };
      totals.set(userId, found);
    }
    return found;
  };
  for (const expense of recap.expenses) {
    sums(expense.payerUserId).paid += expense.totalCents;
    for (const split of expense.splits) sums(split.userId).share += split.amountCents;
    for (const payment of expense.payments) sums(payment.fromUserId).repaid += expense.splits.find((split) => split.userId === payment.fromUserId)?.amountCents ?? 0;
  }
  const open = monthlyPaymentsOpen(recap.month);

  const balances = recap.balances.length ? (
    <ul className={cx(compact ? "row-list" : "shared-group__rows")} aria-label={`Balances for ${monthLabel(recap.month)}`}>
      {recap.balances.map((row) => {
        const member = sums(row.userId);
        const meta = [`Paid ${view.money(member.paid)}`, `share ${view.money(member.share)}`, ...(member.repaid ? [`${view.money(member.repaid)} repaid`] : [])].join(" · ");
        return (
          <li key={row.userId} className="row">
            <Avatar name={view.who.avatar(row.userId)} size={compact ? 32 : 36} />
            <span className="row__main">
              <span className="row__title">{view.who.name(row.userId)}</span>
              <span className="row__meta">{meta}</span>
            </span>
            <span className="row__end">
              <Money cents={row.balanceCents} currency={view.currency} tone={row.balanceCents > 0 ? "income" : "expense"} signed />
              <span className={cx("row__meta", compact && "visually-hidden")}>{row.balanceCents > 0 ? "gets back" : row.balanceCents < 0 ? "owes" : "settled"}</span>
            </span>
          </li>
        );
      })}
    </ul>
  ) : (
    <p className="muted">No shared expenses this month.</p>
  );

  const suggestions = recap.suggestions.length ? (
    <Suggestions view={view} recap={recap} onRecord={onRecord} compact={compact} />
  ) : recap.balances.length ? (
    <p className="muted">Everyone is settled for {monthLabel(recap.month)}.</p>
  ) : null;
  const waiting =
    recap.suggestions.length && !open ? (
      <p className="shared-note">
        <Icon name="time" size={16} />
        <span>
          Monthly payments open on the last day of the month. To repay a single expense now, use <strong>Mark as paid</strong> on its share.
        </span>
      </p>
    ) : null;
  const recorded = recap.reimbursements.length ? (
    <ul className={compact ? "row-list" : "shared-group__rows shared-group__rows--plain"} aria-label={`Recorded payments for ${monthLabel(recap.month)}`}>
      {recap.reimbursements.map((item) => (
        <li key={item.id} className="row row--plain">
          <span className="row__main">
            <span>
              {view.who.name(item.fromUserId)} paid {view.who.name(item.toUserId)}
            </span>
            <span className="row__meta">
              {item.expenseId ? "One expense share" : "Monthly payment"} · recorded by {view.who.name(item.createdBy)}
            </span>
          </span>
          <Money cents={item.amountCents} currency={view.currency} />
        </li>
      ))}
    </ul>
  ) : null;

  if (compact) {
    return (
      <Section title="Balances" status={monthStatus(recap)} compact>
        {balances}
        {recap.suggestions.length ? <h3 className="card__title">Suggested payments</h3> : null}
        {suggestions}
        {waiting}
        {recorded ? <h3 className="card__title">Recorded payments</h3> : null}
        {recorded}
        {note ? <p className="note">{NO_MONEY_NOTE}</p> : null}
      </Section>
    );
  }
  return (
    <>
      <Section title={monthName(recap.month)} status={monthStatus(recap)} compact={false}>
        {balances}
      </Section>
      {recap.suggestions.length ? (
        <Section title="Suggested payments" compact={false}>
          {suggestions}
        </Section>
      ) : (
        suggestions
      )}
      {waiting}
      {recorded ? (
        <Section title="Recorded payments" compact={false}>
          {recorded}
        </Section>
      ) : null}
    </>
  );
}

/** An older month that is still unpaid: its suggested payments, each with Record paid. */
function OverdueMonth({ view, recap, onRecord, compact, note }: { view: HouseholdView; recap: MonthRecap; onRecord: (transfer: Transfer) => void; compact: boolean; note: boolean }) {
  return (
    <Section title={monthName(recap.month)} status={monthStatus(recap)} compact={compact}>
      {recap.suggestions.length ? <Suggestions view={view} recap={recap} onRecord={onRecord} compact={compact} /> : <p className="muted">Everyone is settled for {monthLabel(recap.month)}.</p>}
      {note ? <p className="note">{NO_MONEY_NOTE}</p> : null}
    </Section>
  );
}

/**
 * The full payments that settle a month: "Mira → You", the amount and Record paid. Record paid is
 * copper once the month's payments open and you're one of the two people; before the month's last
 * day it's shown but unavailable, as on the cards.
 */
function Suggestions({ view, recap, onRecord, compact }: { view: HouseholdView; recap: MonthRecap; onRecord: (transfer: Transfer) => void; compact: boolean }) {
  const open = monthlyPaymentsOpen(recap.month);
  return (
    <ul className={compact ? "transfer-list transfer-list--compact" : "shared-group__rows shared-group__rows--plain transfer-list"} aria-label={`Suggested payments for ${monthLabel(recap.month)}`}>
      {recap.suggestions.map((transfer) => {
        const from = view.who.name(transfer.fromUserId);
        const to = view.who.name(transfer.toUserId);
        const involved = view.canWrite && (transfer.fromUserId === view.who.meId || transfer.toUserId === view.who.meId);
        return (
          <li key={`${transfer.fromUserId}:${transfer.toUserId}`} className="transfer">
            <span className="transfer__text">
              <span className="transfer__from">{from}</span>
              <span className="transfer__arrow" aria-hidden="true">
                <Icon name="arrow-up" size={15} />
              </span>
              <span className="visually-hidden">pays</span>
              <span>{to}</span>
            </span>
            <Money cents={transfer.amountCents} currency={view.currency} />
            {involved ? (
              open ? (
                <button type="button" className="pay-pill pay-pill--on" onClick={() => { onRecord(transfer); }} aria-label={`Record that ${from} paid ${to} ${view.money(transfer.amountCents)}`}>
                  Record paid
                </button>
              ) : (
                <button type="button" className="pay-pill" disabled>
                  Record paid
                </button>
              )
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
