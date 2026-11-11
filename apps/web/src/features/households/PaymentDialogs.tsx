import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import { expenseQuery, monthRecapQuery, recordMonthlyPayment, recordSharePayment, refreshHousehold } from "../../api/households";
import type { MonthRecap, SharedExpense, Transfer } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";
import { Button } from "../../design/controls";
import { Dialog } from "../../design/ModalDialog";
import { Money } from "../../design/Money";
import { Banner, SaveErrorBanner, useToast } from "../../design/states";
import type { HouseholdView } from "./context";
import { describeSharedError } from "./errors";
import { dayLabel, monthLabel, shareOf } from "./model";

const NO_TRANSFER_NOTE = "Recording a payment notes money already paid. Penny doesn't transfer money.";

/**
 * Record a full suggested monthly payment (card `iphone-record-payment`, monthly). It documents a
 * transfer that already happened outside Penny. If the balance changed meanwhile, the server
 * refuses (409) and the dialog shows the old and new amounts instead of recording anything.
 */
export function RecordMonthlyDialog({ view, month, transfer, onClose }: { view: HouseholdView; month: string; transfer: Transfer; onClose: () => void }) {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [stale, setStale] = useState<MonthRecap | null>(null);
  const staleRef = useRef<HTMLDivElement>(null);
  const from = view.who.name(transfer.fromUserId);
  const to = view.who.name(transfer.toUserId);
  const monthName = monthLabel(month);

  const record = useMutation({
    mutationKey: ["households", "reimbursement"],
    mutationFn: () => recordMonthlyPayment(view.householdId, month, transfer),
    onSuccess: async () => {
      await refreshHousehold(queryClient, email, view.householdId);
      toast.show({ title: "Payment recorded", detail: `${from} paid ${to} ${view.money(transfer.amountCents)} for ${monthName}. No money moved in Penny.` });
      onClose();
    },
    onError: async (error) => {
      if (!(error instanceof ApiError) || error.status !== 409) return;
      // The month changed under us: re-read it and show what is owed now.
      const latest = await queryClient.query({ ...monthRecapQuery(email, view.householdId, month), staleTime: 0 });
      setStale(latest);
    },
  });

  useEffect(() => {
    if (stale) staleRef.current?.focus();
  }, [stale]);

  if (stale) {
    const now = stale.suggestions.find((item) => item.fromUserId === transfer.fromUserId && item.toUserId === transfer.toUserId);
    return (
      <Dialog
        title="Balance changed"
        onClose={onClose}
        actions={
          <Button variant="primary" onClick={onClose}>
            Review balances
          </Button>
        }
      >
        <div ref={staleRef} tabIndex={-1} role="alert" className="form">
          <p>
            {monthName} changed after you opened this payment, so {view.money(transfer.amountCents)} is no longer the full amount {from === "You" ? "you owe" : `${from} owes`}. Review the
            balances before recording a payment.
          </p>
          <table className="compare">
            <caption className="visually-hidden">Suggested payment before and now</caption>
            <thead>
              <tr>
                <th scope="col">
                  {from} → {to}
                </th>
                <th scope="col">Before</th>
                <th scope="col">Now</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Amount</th>
                <td>
                  <del>{view.money(transfer.amountCents)}</del>
                </td>
                <td>{now ? view.money(now.amountCents) : "Nothing to pay"}</td>
              </tr>
            </tbody>
          </table>
          <p className="note">Nothing was recorded. {NO_TRANSFER_NOTE}</p>
        </div>
      </Dialog>
    );
  }

  const failure = record.isError ? describeSharedError(record.error) : null;
  return (
    <Dialog
      title="Record payment"
      onClose={onClose}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={record.isPending} onClick={() => { record.mutate(); }}>
            {record.isPending ? "Recording…" : `Mark ${view.money(transfer.amountCents)} as paid`}
          </Button>
        </>
      }
    >
      {failure ? <SaveErrorBanner message={failure.message} {...(failure.kind === "offline" || failure.kind === "unreachable" || failure.kind === "other" ? { onRetry: () => { record.mutate(); }, retrying: record.isPending } : {})} /> : null}
      <div className="payment-summary">
        <span>
          <strong>{from}</strong> paid · <strong>{to}</strong> received
        </span>
        <Money cents={transfer.amountCents} currency={view.currency} />
        <span className="muted">Full {monthName} balance</span>
      </div>
      <p className="note">
        Record this once the money has changed hands outside Penny. Penny keeps track; it doesn't send money, and nobody's spending changes.
      </p>
    </Dialog>
  );
}

/**
 * Mark one member's share of an expense as paid (card `iphone-record-payment`). It goes out with
 * the expense revision the person saw; if anyone edited the expense since, the server refuses and
 * the payment-changed state (card `iphone-payment-stale`) shows old and new amounts and offers
 * only Review expense. Nothing is ever recorded twice.
 */
export function RecordShareView({
  view,
  expense,
  fromUserId,
  onDone,
  onReview,
}: {
  view: HouseholdView;
  expense: SharedExpense;
  fromUserId: string;
  onDone: () => void;
  onReview: () => void;
}) {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [stale, setStale] = useState<SharedExpense | null>(null);
  const staleRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const amount = shareOf(expense, fromUserId);
  const from = view.who.name(fromUserId);
  const to = view.who.name(expense.payerUserId);
  // A newer copy may already be in the cache (another tab or a refetch); a mismatch is stale.
  const latest = useQuery({ ...expenseQuery(email, view.householdId, expense.id), enabled: false });

  const record = useMutation({
    mutationKey: ["households", "share-payment"],
    mutationFn: () => recordSharePayment(view.householdId, expense.id, fromUserId, expense.revision),
    onSuccess: async () => {
      await refreshHousehold(queryClient, email, view.householdId);
      toast.show({ title: "Share marked as paid", detail: `${from} repaid ${to} ${view.money(amount)} for ${expense.title}. No money moved in Penny.` });
      onDone();
    },
    onError: async (error) => {
      if (!(error instanceof ApiError) || error.status !== 409) return;
      const fresh = await queryClient.query({ ...expenseQuery(email, view.householdId, expense.id), staleTime: 0 }).catch(() => null);
      void refreshHousehold(queryClient, email, view.householdId);
      if (fresh && fresh.revision !== expense.revision) setStale(fresh);
    },
  });

  // While recording (and after), our own payment bumps the revision: that is not someone else's edit.
  const cachedNewer = !record.isPending && !record.isSuccess && latest.data && latest.data.revision !== expense.revision ? latest.data : null;
  const changed = stale ?? cachedNewer;
  const changedRevision = changed?.revision;

  useEffect(() => {
    if (changedRevision !== undefined) staleRef.current?.focus();
  }, [changedRevision]);

  if (changed) {
    const editor = view.who.name(changed.updatedBy);
    return (
      <div ref={staleRef} tabIndex={-1} className="form" role="alert" aria-labelledby={titleId}>
        <h3 id={titleId} style={{ margin: 0 }}>
          {changed.title} changed
        </h3>
        <p>
          {editor === "You" ? "You" : editor} edited this expense after you opened it. Review it before recording a payment.
        </p>
        <table className="compare">
          <caption className="visually-hidden">Expense before and after the edit</caption>
          <thead>
            <tr>
              <td />
              <th scope="col">Before</th>
              <th scope="col">Now</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Total</th>
              <td>
                <del>{view.money(expense.totalCents)}</del>
              </td>
              <td>{view.money(changed.totalCents)}</td>
            </tr>
            <tr>
              <th scope="row">{from === "You" ? "Your share" : `${from}'s share`}</th>
              <td>
                <del>{view.money(amount)}</del>
              </td>
              <td>{view.money(shareOf(changed, fromUserId))}</td>
            </tr>
          </tbody>
        </table>
        <p className="muted">
          Edited by {editor} · <time dateTime={new Date(changed.updatedAt).toISOString()}>{new Date(changed.updatedAt).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time>
        </p>
        <div className="form-actions">
          <Button variant="primary" onClick={onReview}>
            Review expense
          </Button>
        </div>
        <p className="note">Nothing was recorded. {NO_TRANSFER_NOTE}</p>
      </div>
    );
  }

  const failure = record.isError ? describeSharedError(record.error) : null;
  const retryable = failure && (failure.kind === "offline" || failure.kind === "unreachable" || failure.kind === "other");
  return (
    <div className="form">
      <h3 id={titleId} tabIndex={-1} style={{ margin: 0 }}>
        Record payment
      </h3>
      {failure ? <SaveErrorBanner message={failure.message} {...(retryable ? { onRetry: () => { record.mutate(); }, retrying: record.isPending } : {})} /> : null}
      <div className="payment-summary">
        <span>
          <strong>{from}</strong> paid · <strong>{to}</strong> received
        </span>
        <Money cents={amount} currency={view.currency} />
        <span className="muted">
          {from === "You" ? "Your" : `${from}'s`} share of {expense.title} · {dayLabel(expense.date)}
        </span>
        <span className="muted">Full share</span>
      </div>
      <p className="note">
        Record this once {from === "You" ? "you have" : `${from} has`} paid {to === "You" ? "you" : to} outside Penny. Penny keeps track; it doesn't send money, and nobody's spending
        changes.
      </p>
      {expense.paymentsClosed ? (
        <Banner tone="info" title="This month is being settled monthly">
          A monthly payment was already recorded for this month. Settle the rest from Balances.
        </Banner>
      ) : null}
      <div className="form-actions">
        <Button variant="quiet" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" busy={record.isPending} onClick={() => { record.mutate(); }}>
          {record.isPending ? "Recording…" : `Mark ${view.money(amount)} as paid`}
        </Button>
      </div>
    </div>
  );
}
