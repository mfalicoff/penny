import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type RefObject } from "react";
import { ApiError } from "../../api/client";
import { deleteExpense, expenseQuery, refreshHousehold } from "../../api/households";
import type { SharedExpense } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";
import { Badge, Button } from "../../design/controls";
import { Dialog } from "../../design/ModalDialog";
import { Money } from "../../design/Money";
import { EmptyState, ErrorState, LoadingState, SaveErrorBanner, useToast } from "../../design/states";
import type { HouseholdView } from "./context";
import { useLedgerChoices } from "./choices";
import { describeLoadError, describeSharedError } from "./errors";
import { HistoryPanel } from "./HistoryPanel";
import { canRecordShare, dayLabel, isPaid, possessive, SHARE_STATUS_LABEL, shareOf, shareStatus, splitLabel } from "./model";
import { ReceiptLink } from "../receipts/ReceiptLink";
import { RecordShareView } from "./PaymentDialogs";

type Pane = { kind: "detail" } | { kind: "record"; expense: SharedExpense; fromUserId: string } | { kind: "delete" } | { kind: "history" };

/**
 * One shared expense (specimen `shared-expense-detail`), in a panel over the household: the
 * original total, who paid, the viewer's share, every member's share and repayment, and its
 * change history. Recording a share payment and deleting happen in the same panel.
 */
export function ExpenseDetailDialog({ view, expenseId, onEdit, onClose }: { view: HouseholdView; expenseId: string; onEdit: (expense: SharedExpense) => void; onClose: () => void }) {
  const email = useAccountEmail();
  const expense = useQuery(expenseQuery(email, view.householdId, expenseId));
  const [pane, setPane] = useState<Pane>({ kind: "detail" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const opened = useRef(false);

  // Switching panes replaces the focused control, so move focus to the new pane's heading (or its
  // first control): focus never falls back to the page behind the dialog, and Escape keeps working.
  // After "Review expense" this lands on the refreshed expense.
  useEffect(() => {
    if (!opened.current) {
      opened.current = true;
      return;
    }
    bodyRef.current?.querySelector<HTMLElement>("h3[tabindex], button, input")?.focus();
  }, [pane]);

  const title = expense.data?.title ?? "Expense";
  let body;
  if (expense.isPending) body = <LoadingState label="Loading the expense…" />;
  else if (expense.isError && !expense.data) {
    body =
      expense.error instanceof ApiError && expense.error.status === 404 ? (
        <EmptyState icon="receipt" title="This expense isn't here anymore">
          <p>Someone deleted or moved it, or you no longer have a share in it.</p>
        </EmptyState>
      ) : (
        <ErrorState onRetry={() => void expense.refetch()} retrying={expense.isFetching}>
          {describeLoadError(expense.error)}
        </ErrorState>
      );
  } else {
    const data = expense.data;
    if (pane.kind === "record") {
      body = (
        <RecordShareView
          view={view}
          expense={pane.expense}
          fromUserId={pane.fromUserId}
          onDone={() => { setPane({ kind: "detail" }); }}
          onReview={() => {
            setPane({ kind: "detail" });
          }}
        />
      );
    } else if (pane.kind === "delete") {
      body = <DeletePane view={view} expense={data} onCancel={() => { setPane({ kind: "detail" }); }} onDeleted={onClose} />;
    } else if (pane.kind === "history") {
      body = (
        <div className="form">
          <HistoryPanel view={view} expenseId={data.id} />
          <Button variant="quiet" onClick={() => { setPane({ kind: "detail" }); }} style={{ justifySelf: "start" }}>
            Back to the expense
          </Button>
        </div>
      );
    } else {
      body = (
        <DetailPane
          view={view}
          expense={data}
          headingRef={headingRef}
          onRecord={(fromUserId) => { setPane({ kind: "record", expense: data, fromUserId }); }}
          onDelete={() => { setPane({ kind: "delete" }); }}
          onHistory={() => { setPane({ kind: "history" }); }}
          onEdit={() => {
            onEdit(data);
          }}
        />
      );
    }
  }

  return (
    <Dialog title={title} onClose={onClose} wide>
      <div ref={bodyRef} className="form">
        {body}
      </div>
    </Dialog>
  );
}

function DetailPane({
  view,
  expense,
  headingRef,
  onRecord,
  onDelete,
  onHistory,
  onEdit,
}: {
  view: HouseholdView;
  expense: SharedExpense;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onRecord: (fromUserId: string) => void;
  onDelete: () => void;
  onHistory: () => void;
  onEdit: () => void;
}) {
  const choices = useLedgerChoices(expense.accountId !== undefined);
  const me = view.who.meId;
  const mine = shareOf(expense, me);
  const payerIsMe = me !== undefined && expense.payerUserId === me;
  const accountName = expense.accountId ? choices.accounts.find((account) => account.id === expense.accountId)?.name : undefined;

  return (
    <div className="form">
      <h3 ref={headingRef} tabIndex={-1} className="visually-hidden">
        {expense.title} details
      </h3>
      <dl className="detail-grid">
        <dt>Total</dt>
        <dd>
          <Money cents={expense.totalCents} currency={view.currency} />
        </dd>
        <dt>Date</dt>
        <dd>
          <time dateTime={expense.date}>{dayLabel(expense.date, true)}</time>
          {expense.recurringId ? " · added by a repeating expense" : ""}
        </dd>
        <dt>Category</dt>
        <dd>{expense.category.name}</dd>
        <dt>Paid by</dt>
        <dd>{view.who.name(expense.payerUserId)}</dd>
        <dt>Split</dt>
        <dd>{splitLabel(expense)}</dd>
        {payerIsMe ? (
          <>
            <dt>Your account</dt>
            <dd>{expense.accountId ? (accountName ?? "Selected") : "None"} · only you see this</dd>
          </>
        ) : null}
        {expense.note ? (
          <>
            <dt>Note</dt>
            <dd>{expense.note}</dd>
          </>
        ) : null}
        {expense.receipt ? (
          <>
            <dt>Receipt</dt>
            <dd>
              <ReceiptLink receipt={expense.receipt} />
            </dd>
          </>
        ) : null}
      </dl>
      {!payerIsMe ? <p className="note">The payer's account stays private to them.</p> : null}
      {me && expense.splits.some((split) => split.userId === me) ? (
        <div className="your-share">
          <span>Your share · in your spending</span>
          <Money cents={mine} currency={view.currency} />
        </div>
      ) : null}

      <section aria-labelledby={`shares-${expense.id}`} className="shared-section">
        <h3 id={`shares-${expense.id}`} className="card__title">
          Shares
        </h3>
        <ul className="row-list">
          {expense.splits.map((split) => {
            const status = shareStatus(expense, split.userId, split.amountCents);
            return (
              <li key={split.userId} className="row row--plain">
                <span>
                  <span className="row__title">{view.who.name(split.userId)}</span>
                  <span className="row__meta" style={{ display: "block" }}>
                    {status === "paid" ? (
                      <Badge tone="income" icon="checkmark">
                        {SHARE_STATUS_LABEL[status]}
                      </Badge>
                    ) : (
                      SHARE_STATUS_LABEL[status]
                    )}
                  </span>
                </span>
                <span className="row__end">
                  <Money cents={split.amountCents} currency={view.currency} />
                  {canRecordShare(expense, split.userId, view.who, view.archived) ? (
                    <Button variant="secondary" onClick={() => { onRecord(split.userId); }} aria-label={`Mark ${possessive(view.who.name(split.userId))} share as paid`}>
                      Mark as paid
                    </Button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
        {expense.paymentsClosed ? <p className="note">This month has a monthly payment, so the remaining shares settle from Balances.</p> : null}
      </section>

      <div className="form-actions" style={{ justifyContent: "flex-start" }}>
        {view.canWrite ? (
          <Button variant="primary" icon="create" onClick={onEdit}>
            Edit
          </Button>
        ) : null}
        <Button variant="quiet" icon="time" onClick={onHistory}>
          Change history
        </Button>
        {view.canWrite && !isPaid(expense) ? (
          <Button variant="danger-quiet" icon="trash" onClick={onDelete}>
            Delete
          </Button>
        ) : null}
      </div>
      {view.canWrite && isPaid(expense) ? <p className="note">A share of this expense is already repaid, so it can't be deleted, and its payer, total, month and shares are fixed.</p> : null}
    </div>
  );
}

/** Confirmation before deleting a shared expense for everyone (interaction baseline, Feedback). */
function DeletePane({ view, expense, onCancel, onDeleted }: { view: HouseholdView; expense: SharedExpense; onCancel: () => void; onDeleted: () => void }) {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const toast = useToast();
  const remove = useMutation({
    mutationKey: ["households", "expense", "delete"],
    mutationFn: () => deleteExpense(view.householdId, expense.id, expense.revision),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: expenseQuery(email, view.householdId, expense.id).queryKey });
      await refreshHousehold(queryClient, email, view.householdId);
      toast.show({ title: `${expense.title} deleted`, detail: "It's gone from everyone's expenses and balances. Its history stays." });
      onDeleted();
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: expenseQuery(email, view.householdId, expense.id).queryKey }),
  });
  return (
    <div className="form" role="group" aria-labelledby={`delete-${expense.id}`}>
      <h3 id={`delete-${expense.id}`} tabIndex={-1} style={{ margin: 0 }}>
        Delete {expense.title} for everyone?
      </h3>
      <p className="muted">It disappears from every member's expenses, balances and reports. Its change history stays.</p>
      {remove.isError ? <SaveErrorBanner message={describeSharedError(remove.error).message} /> : null}
      <div className="form-actions">
        <Button variant="quiet" onClick={onCancel}>
          Keep it
        </Button>
        <Button variant="danger" busy={remove.isPending} onClick={() => { remove.mutate(); }}>
          {remove.isPending ? "Deleting…" : "Delete for everyone"}
        </Button>
      </div>
    </div>
  );
}
