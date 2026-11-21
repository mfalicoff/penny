import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { ApiError } from "../../api/client";
import { expenseQuery, monthRecapQuery, recordMonthlyPayment, recordSharePayment, refreshHousehold } from "../../api/households";
import type { MonthRecap, SharedExpense, Transfer } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";
import { Avatar, Button } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { Dialog } from "../../design/ModalDialog";
import { Money } from "../../design/Money";
import { Banner, SaveErrorBanner, useToast } from "../../design/states";
import type { HouseholdView } from "./context";
import { describeLoadError, describeSharedError } from "./errors";
import { monthLabel, possessive, shareOf, shortDate, staleChange } from "./model";

const NO_TRANSFER_NOTE = "Recording a payment notes money already paid. Penny doesn't transfer money.";

/**
 * Who paid whom (card `iphone-record-payment`): the payer's and receiver's avatars joined by a
 * dashed arrow, "paid" and "received" under their names, then the amount, what it is for and a
 * pill (Full share, or the full month's balance).
 */
function PaymentSummary({ view, fromUserId, toUserId, cents, detail, pill }: { view: HouseholdView; fromUserId: string; toUserId: string; cents: number; detail: string; pill: string }) {
  const from = view.who.name(fromUserId);
  const to = view.who.name(toUserId);
  return (
    // Opening the payment moves focus here, never onto Mark as paid.
    <div className="payment-summary" tabIndex={-1} data-pane-focus>
      <p className="payment-people">
        <span className="payment-person">
          <Avatar name={view.who.avatar(fromUserId)} size={64} />
          <strong>{from}</strong>
          <span className="muted">paid</span>
        </span>
        <span className="payment-people__arrow" aria-hidden="true" />
        <span className="payment-person">
          <Avatar name={view.who.avatar(toUserId)} size={64} />
          <strong>{to}</strong>
          <span className="muted">received</span>
        </span>
      </p>
      <Money cents={cents} currency={view.currency} className="payment-summary__amount" />
      <span className="payment-summary__detail">{detail}</span>
      <span className="payment-summary__pill">
        <Icon name="lock-closed" size={14} />
        {pill}
      </span>
    </div>
  );
}

/** The note under the summary, with the card's check icon. */
function PaymentNote({ children }: { children: ReactNode }) {
  return (
    <p className="payment-note">
      <Icon name="checkmark-circle" size={18} />
      <span>{children}</span>
    </p>
  );
}

/** "2 min ago", "just now", or the time and day for older changes (card `iphone-payment-stale`). */
function whenLabel(at: number, now = Date.now()): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${String(minutes)} min ago`;
  return new Date(at).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * The payment-changed state (card `iphone-payment-stale`): a red banner naming what changed, the
 * values that changed (struck-through before, then now) with who changed it and when, and one
 * full-width action. Nothing was recorded.
 */
function StaleState({
  focusRef,
  title,
  message,
  rows,
  by,
  action,
}: {
  focusRef: RefObject<HTMLDivElement | null>;
  title: string;
  message: string;
  rows: { label: string; before: string; now: string }[];
  by: { label: string; value: string } | null;
  action: ReactNode;
}) {
  const titleId = useId();
  return (
    <div ref={focusRef} tabIndex={-1} className="form payment-stale" role="alert" aria-labelledby={titleId}>
      <div className="payment-stale__banner">
        <Icon name="alert-circle" size={22} />
        <span>
          <strong id={titleId}>{title}</strong>
          <span>{message}</span>
        </span>
      </div>
      {rows.length || by ? (
        <dl className="payment-stale__rows" aria-label="What changed since you opened this payment">
          {rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>
                <del>
                  <span className="visually-hidden">was </span>
                  {row.before}
                </del>{" "}
                <span className="visually-hidden">now </span>
                <strong>{row.now}</strong>
              </dd>
            </div>
          ))}
          {by ? (
            <div>
              <dt>{by.label}</dt>
              <dd>
                <strong>{by.value}</strong>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {action}
      <p className="note payment-stale__note">Nothing was recorded. {NO_TRANSFER_NOTE}</p>
    </div>
  );
}

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
  /** Why re-reading the month after a 409 failed; the balance changed but the new amount is unknown. */
  const [rereadFailed, setRereadFailed] = useState<string | null>(null);
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
    onMutate: () => {
      setRereadFailed(null);
    },
    onError: async (error) => {
      if (!(error instanceof ApiError) || error.status !== 409) return;
      // The month changed under us: re-read it and show what is owed now. If that read fails too,
      // say so (nothing was recorded) instead of showing only the server's 409 text.
      try {
        setStale(await queryClient.query({ ...monthRecapQuery(email, view.householdId, month), staleTime: 0 }));
      } catch (failure) {
        setRereadFailed(describeLoadError(failure));
      }
    },
  });

  useEffect(() => {
    if (stale) staleRef.current?.focus();
  }, [stale]);

  if (stale) {
    const now = stale.suggestions.find((item) => item.fromUserId === transfer.fromUserId && item.toUserId === transfer.toUserId);
    return (
      <Dialog title="Record payment" onClose={onClose}>
        <StaleState
          focusRef={staleRef}
          title={`${monthName} changed`}
          message={`${monthName} changed after you opened this payment, so ${view.money(transfer.amountCents)} is no longer the full amount ${from === "You" ? "you owe" : `${from} owes`}. Review the balances before recording a payment.`}
          rows={[{ label: `${from} → ${to}`, before: view.money(transfer.amountCents), now: now ? view.money(now.amountCents) : "Nothing to pay" }]}
          by={null}
          action={
            <Button variant="primary" className="wbtn--block" onClick={onClose}>
              Review balances
            </Button>
          }
        />
      </Dialog>
    );
  }

  const failure = record.isError
    ? rereadFailed !== null
      ? { kind: "conflict" as const, message: `${monthName} changed after you opened this payment, so nothing was recorded. Penny couldn't load the new balance either: ${rereadFailed} Review the balances before recording a payment.` }
      : describeSharedError(record.error)
    : null;
  return (
    <Dialog title="Record payment" onClose={onClose}>
      <div className="form">
        {failure ? <SaveErrorBanner message={failure.message} {...(failure.kind === "offline" || failure.kind === "unreachable" || failure.kind === "other" ? { onRetry: () => { record.mutate(); }, retrying: record.isPending } : {})} /> : null}
        <PaymentSummary view={view} fromUserId={transfer.fromUserId} toUserId={transfer.toUserId} cents={transfer.amountCents} detail={`${monthName} balance`} pill="Full balance" />
        <PaymentNote>Record this once the money has changed hands outside Penny. Penny keeps track — it doesn't send money, and nobody's spending changes.</PaymentNote>
        <Button variant="primary" icon="checkmark" className="wbtn--block" busy={record.isPending} onClick={() => { record.mutate(); }}>
          {record.isPending ? "Recording…" : `Mark ${view.money(transfer.amountCents)} as paid`}
        </Button>
      </div>
    </Dialog>
  );
}

/**
 * Mark one member's share of an expense as paid (card `iphone-record-payment`). It goes out with
 * the expense revision the person saw; if the expense changed since, the server refuses and the
 * payment-changed state (card `iphone-payment-stale`) offers only Review expense. It names the real
 * cause (another payment, often the same person on another device; a monthly payment; or an
 * edit) and lists only the values that changed. Nothing is ever recorded twice. The host titles
 * it Record payment.
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
    const { cause, rows } = staleChange(expense, changed, fromUserId, view.money, view.who.name);
    const actor = cause.kind === "payment" ? view.who.name(cause.recordedBy) : cause.kind === "edit" ? view.who.name(cause.editedBy) : null;
    const message =
      cause.kind === "payment"
        ? cause.fromUserId === fromUserId
          ? `${actor} already recorded ${possessive(from)} share as paid after you opened this payment${actor === "You" ? ", maybe on another device" : ""}. There's nothing left to record for it.`
          : `${actor} recorded a payment on this expense after you opened it. Review it before recording a payment.`
        : cause.kind === "monthly"
          ? `A monthly payment was recorded for ${monthLabel(changed.date.slice(0, 7))} after you opened this payment, so this share now settles with the month.`
          : `${actor} edited this expense after you opened it. Review it before recording a payment.`;
    const by = cause.kind === "monthly" || actor === null ? null : { label: cause.kind === "payment" ? "Recorded" : "Edited", value: `${actor} · ${whenLabel(cause.at)}` };
    return (
      <StaleState
        focusRef={staleRef}
        title={cause.kind === "edit" ? `${changed.title} changed` : `${changed.title} payment changed`}
        message={message}
        rows={rows}
        by={by}
        action={
          <Button variant="primary" className="wbtn--block" onClick={onReview}>
            Review expense
          </Button>
        }
      />
    );
  }

  const failure = record.isError ? describeSharedError(record.error) : null;
  const retryable = failure && (failure.kind === "offline" || failure.kind === "unreachable" || failure.kind === "other");
  return (
    <div className="form">
      {failure ? <SaveErrorBanner message={failure.message} {...(retryable ? { onRetry: () => { record.mutate(); }, retrying: record.isPending } : {})} /> : null}
      <PaymentSummary
        view={view}
        fromUserId={fromUserId}
        toUserId={expense.payerUserId}
        cents={amount}
        detail={`${from === "You" ? "Your" : `${from}'s`} share of ${expense.title} · ${shortDate(expense.date)}`}
        pill="Full share"
      />
      <PaymentNote>
        Record this once {from === "You" ? "you have" : `${from} has`} paid {to === "You" ? "you" : to} outside Penny. Penny keeps track — it doesn't send money, and nobody's spending changes.
      </PaymentNote>
      {expense.paymentsClosed ? (
        <Banner tone="info" title="This month is being settled monthly">
          A monthly payment was already recorded for this month. Settle the rest from Balances.
        </Banner>
      ) : null}
      <Button variant="primary" icon="checkmark" className="wbtn--block" busy={record.isPending} onClick={() => { record.mutate(); }}>
        {record.isPending ? "Recording…" : `Mark ${view.money(amount)} as paid`}
      </Button>
    </div>
  );
}
