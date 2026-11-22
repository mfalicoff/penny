import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useId, useRef, useState, type RefObject } from "react";
import { ApiError } from "../../api/client";
import { deleteExpense, expenseQuery, refreshHousehold } from "../../api/households";
import type { SharedExpense } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";
import { Avatar, Badge, Button } from "../../design/controls";
import { tileStyle } from "../../design/categoryTint";
import { Dialog } from "../../design/ModalDialog";
import { Icon } from "../../design/Icon";
import { Money } from "../../design/Money";
import { EmptyState, ErrorState, LoadingState, SaveErrorBanner, useToast } from "../../design/states";
import type { HouseholdView } from "./context";
import { useLedgerChoices } from "./choices";
import { describeLoadError, describeSharedError } from "./errors";
import { HistoryPanel } from "./HistoryPanel";
import { canRecordShare, dayLabel, isPaid, possessive, SHARE_STATUS_LABEL, shareOf, shareStatus, shortDate, splitLabel } from "./model";
import { MoreMenu, type MoreItem } from "./GroupTools";
import { ReceiptLink } from "../receipts/ReceiptLink";
import { ConfirmDeleteDialog, shortDay } from "../entries/EntryDetail";
import { categoryIcon } from "../entries/model";
import { RecordShareView } from "./PaymentDialogs";

type Pane = { kind: "detail" } | { kind: "record"; expense: SharedExpense; fromUserId: string } | { kind: "delete" } | { kind: "history" };

interface DetailProps {
  view: HouseholdView;
  expenseId: string;
  onEdit: (expense: SharedExpense) => void;
  onClose: () => void;
  /** Opens the repeating expense that added this one (MAZ-229: the household has no Repeating card). */
  onRule?: (ruleId: string) => void;
  /**
   * `panel`: the selected expense in the household's side pane from 1100px (cards `ipad-shared`,
   * `web-household`), instead of a dialog over the page.
   */
  variant?: "dialog" | "panel";
  /**
   * The touch tablet's pane (`ipad-shared`): a short card, with the title and "Jo paid $184.20 ·
   * Nov 4", then each member's share with Paid or Mark as paid. Edit, Change history, Repeating
   * expense and Delete are in its … menu. The pane always shows an expense, so it has no Close.
   */
  compact?: boolean;
  /** Whether opening this expense moves focus to it: not when the page picked it, only when someone did. */
  focusOnOpen?: (expenseId: string) => boolean;
}

/**
 * One shared expense (specimen `shared-expense-detail`), in a dialog over the household or in the
 * pane beside its expenses: the original total, who paid, the viewer's share, every member's share
 * and repayment, and its change history. Recording a share payment and deleting happen in the
 * same place.
 */
export function ExpenseDetailDialog({ view, expenseId, onEdit, onClose, onRule, variant = "dialog", compact = false, focusOnOpen }: DetailProps) {
  const email = useAccountEmail();
  const expense = useQuery(expenseQuery(email, view.householdId, expenseId));
  const [pane, setPane] = useState<Pane>({ kind: "detail" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  const panelTitleId = useId();
  const panelHeading = useRef<HTMLHeadingElement>(null);

  // In the side pane, opening an expense moves focus to it, as opening the dialog does.
  const shouldFocus = useEffectEvent((id: string) => focusOnOpen?.(id) ?? true);
  useEffect(() => {
    if (variant === "panel" && shouldFocus(expenseId)) panelHeading.current?.focus();
  }, [variant, expenseId]);

  // Switching panes replaces the focused control, so move focus to the new pane's heading (or its
  // first control): focus never falls back to the page behind the dialog, and Escape keeps working.
  // After "Review expense" this lands on the refreshed expense.
  const previousPane = useRef(pane.kind);
  useEffect(() => {
    const from = previousPane.current;
    previousPane.current = pane.kind;
    if (!opened.current) {
      opened.current = true;
      return;
    }
    // The delete confirmation is its own dialog: it takes focus, and gives it back to Delete.
    if (pane.kind === "delete" || from === "delete") return;
    bodyRef.current?.querySelector<HTMLElement>("[data-pane-focus], h3[tabindex], button, input")?.focus();
  }, [pane]);

  // Recording a share is the card's Record payment sheet: titled so, and closing it returns to the expense.
  const recording = pane.kind === "record";
  const title = recording ? "Record payment" : (expense.data?.title ?? "Expense");
  const close = recording ? () => { setPane({ kind: "detail" }); } : onClose;
  const detailPane = (data: SharedExpense) => (
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
      {...(onRule && data.recurringId ? { onRule: () => { onRule(data.recurringId ?? ""); } } : {})}
    />
  );
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
      body = (
        <>
          {detailPane(data)}
          <DeleteSharedDialog view={view} expense={data} onCancel={() => { setPane({ kind: "detail" }); }} onDeleted={onClose} />
        </>
      );
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
      body = detailPane(data);
    }
  }

  const short = variant === "panel" && compact && expense.data && (pane.kind === "detail" || pane.kind === "delete") ? expense.data : undefined;
  if (short) {
    const actions: MoreItem[] = [
      ...(view.canWrite ? [{ label: "Edit", icon: "create" as const, onSelect: () => { onEdit(short); } }] : []),
      { label: "Change history", icon: "time" as const, onSelect: () => { setPane({ kind: "history" }); } },
      ...(onRule && short.recurringId ? [{ label: "Repeating expense", icon: "repeat" as const, onSelect: () => { onRule(short.recurringId ?? ""); } }] : []),
      ...(view.canWrite && !isPaid(short) ? [{ label: "Delete", icon: "trash" as const, onSelect: () => { setPane({ kind: "delete" }); } }] : []),
    ];
    return (
      <section className="card expense-panel expense-panel--compact" aria-labelledby={panelTitleId}>
        <div className="expense-panel__head">
          <h2 id={panelTitleId} ref={panelHeading} tabIndex={-1} className="card__title">
            {title}
          </h2>
          <span className="expense-panel__sub">
            {view.who.name(short.payerUserId)} paid {view.money(short.totalCents)} · {shortDate(short.date)}
          </span>
          <MoreMenu items={actions} label={`${title} actions`} />
        </div>
        <div ref={bodyRef}>
          <CompactShares view={view} expense={short} onRecord={(fromUserId) => { setPane({ kind: "record", expense: short, fromUserId }); }} />
          {pane.kind === "delete" ? <DeleteSharedDialog view={view} expense={short} onCancel={() => { setPane({ kind: "detail" }); }} onDeleted={onClose} /> : null}
        </div>
      </section>
    );
  }

  if (variant === "panel") {
    return (
      <section className="card expense-panel" aria-labelledby={panelTitleId}>
        <div className="expense-panel__head">
          <h2 id={panelTitleId} ref={panelHeading} tabIndex={-1} className="card__title">
            {title}
          </h2>
          {!compact || recording ? (
            <button type="button" className="wbtn wbtn--icon" aria-label={`Close ${title}`} onClick={close}>
              <Icon name="close" size={16} weight={44} />
            </button>
          ) : null}
        </div>
        <div ref={bodyRef} className="form">
          {body}
        </div>
      </section>
    );
  }

  return (
    <Dialog title={title} onClose={close} wide={!recording}>
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
  onRule,
}: {
  view: HouseholdView;
  expense: SharedExpense;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onRecord: (fromUserId: string) => void;
  onDelete: () => void;
  onHistory: () => void;
  onEdit: () => void;
  onRule?: () => void;
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
        {onRule ? (
          <Button variant="quiet" icon="repeat" onClick={onRule}>
            Repeating expense
          </Button>
        ) : null}
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

/**
 * `ipad-shared`'s selected expense: one row per member with their share, and Paid (green), Mark as
 * paid (copper, where you can record it) or how it stands; the payer is "· payer".
 */
function CompactShares({ view, expense, onRecord }: { view: HouseholdView; expense: SharedExpense; onRecord: (fromUserId: string) => void }) {
  return (
    <>
      <h3 className="visually-hidden">Shares</h3>
      <ul className="row-list expense-shares" aria-label={`Shares of ${expense.title}`}>
        {expense.splits.map((split) => {
          const payer = split.userId === expense.payerUserId;
          const status = shareStatus(expense, split.userId, split.amountCents);
          let state = null;
          if (!payer && status === "paid") {
            state = (
              <Badge tone="income" icon="checkmark">
                {SHARE_STATUS_LABEL[status]}
              </Badge>
            );
          } else if (!payer && canRecordShare(expense, split.userId, view.who, view.archived)) {
            state = (
              <button type="button" className="pay-pill pay-pill--on" onClick={() => { onRecord(split.userId); }} aria-label={`Mark ${possessive(view.who.name(split.userId))} share as paid`}>
                Mark as paid
              </button>
            );
          } else if (!payer) {
            state = <span className="row__meta">{SHARE_STATUS_LABEL[status]}</span>;
          }
          return (
            <li key={split.userId} className="row expense-share">
              <Avatar name={view.who.avatar(split.userId)} size={30} />
              <span className="expense-share__name">
                {view.who.name(split.userId)}
                {payer ? " · payer" : ""}
              </span>
              <Money cents={split.amountCents} currency={view.currency} />
              {state}
            </li>
          );
        })}
      </ul>
      {expense.paymentsClosed ? <p className="note">This month has a monthly payment, so the remaining shares settle from Balances.</p> : null}
    </>
  );
}

/**
 * Confirmation before deleting a shared expense for everyone (`iphone-delete-confirm`): its tile,
 * 'Delete “Title”?' with the total, date and household, the members, what deleting does to them,
 * then Delete for everyone over Cancel. A centered dialog over the expense (MAZ-227).
 */
function DeleteSharedDialog({ view, expense, onCancel, onDeleted }: { view: HouseholdView; expense: SharedExpense; onCancel: () => void; onDeleted: () => void }) {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const toast = useToast();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
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
  const members = [...new Set(expense.splits.map((split) => split.userId))];
  const others = members.filter((userId) => userId !== view.who.meId).map((userId) => view.who.name(userId));
  const month = new Date(`${expense.date}T12:00:00Z`).toLocaleDateString("en-CA", { month: "long", timeZone: "UTC" });
  return (
    <ConfirmDeleteDialog
      titleId={titleId}
      descriptionId={descriptionId}
      title={`Delete “${expense.title}”?`}
      line={[view.money(expense.totalCents), shortDay(expense.date), view.detail.household.name].join(" · ")}
      tile={
        <span className="category-dot category-dot--large" style={tileStyle(expense.category)}>
          <Icon name={categoryIcon(expense.category.icon)} size={24} />
        </span>
      }
      aside={
        <span className="confirm-sheet__people">
          {members.map((userId) => (
            <Avatar key={userId} name={view.who.name(userId)} size={34} />
          ))}
        </span>
      }
      onClose={onCancel}
      cancelRef={cancelRef}
      confirm={
        <Button variant="danger" busy={remove.isPending} onClick={() => { remove.mutate(); }}>
          {remove.isPending ? "Deleting…" : "Delete for everyone"}
        </Button>
      }
    >
      <p className="confirm-sheet__note confirm-sheet__note--box">
        <Icon name="people" size={20} />
        <span>
          This expense is shared. Deleting it removes it for {others.length ? listNames(others) : "every member"} too, and recalculates {month} balances.
        </span>
      </p>
      {remove.isError ? <SaveErrorBanner message={describeSharedError(remove.error).message} /> : null}
    </ConfirmDeleteDialog>
  );
}

/** "A", "A and B", "A, B and C". */
function listNames(names: string[]): string {
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}
