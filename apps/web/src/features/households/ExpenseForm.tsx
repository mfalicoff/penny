import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { ApiError } from "../../api/client";
import { createExpense, createRule, expenseQuery, recurringQuery, refreshHousehold, timezoneOffsetMinutes, updateExpense, updateRule } from "../../api/households";
import type { Allocation, ExpenseInput, Frequency, HouseholdMember, SharedCategory, SharedExpense, SharedRecurring, SplitMode } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";
import { Avatar, Button, ChoiceGroup, SwitchRow } from "../../design/controls";
import { Dialog } from "../../design/ModalDialog";
import { Banner, SaveErrorBanner, useToast } from "../../design/states";
import { CategoryFormDialog } from "../organize/CategoryFormDialog";
import { useLedgerWorkspace } from "../organize/workspace";
import type { HouseholdView } from "./context";
import { useLedgerChoices } from "./choices";
import { describeSharedError } from "./errors";
import {
  centsToInput,
  eligibleMembers,
  equalSplit,
  isCurrent,
  isPaid,
  localDate,
  MAX_CENTS,
  monthLabel,
  parseAmount,
  parsePercent,
  percentSplit,
  pointsToInput,
} from "./model";

export type FormTarget = { kind: "new" } | { kind: "edit"; expense: SharedExpense } | { kind: "rule"; rule: SharedRecurring };

type Repeat = "none" | Frequency;

interface Draft {
  title: string;
  amount: string;
  date: string;
  category: string;
  payerUserId: string;
  splitMode: SplitMode;
  exact: Record<string, string>;
  percent: Record<string, string>;
  accountId: string;
  note: string;
  repeat: Repeat;
  active: boolean;
}

type Field = "title" | "amount" | "date" | "payer" | "split";

/** What expenses and repeating expenses share; the date field differs (`date` or `nextDate`). */
type Base = Omit<ExpenseInput, "date">;

function allocationInputs(allocations: readonly Allocation[] | undefined, splits?: readonly { userId: string; amountCents: number }[]) {
  const exact: Record<string, string> = {};
  const percent: Record<string, string> = {};
  for (const split of splits ?? []) exact[split.userId] = centsToInput(split.amountCents);
  for (const item of allocations ?? []) {
    if ("amountCents" in item) exact[item.userId] = centsToInput(item.amountCents);
    else percent[item.userId] = pointsToInput(item.percentBasisPoints);
  }
  return { exact, percent };
}

function draftFrom(target: FormTarget, meId: string | undefined, fallbackCategory: string): Draft {
  if (target.kind === "edit") {
    const { expense } = target;
    return {
      title: expense.title,
      amount: centsToInput(expense.totalCents),
      date: expense.date,
      category: expense.category.name,
      payerUserId: expense.payerUserId,
      splitMode: expense.splitMode,
      ...allocationInputs(expense.allocations, expense.splits),
      accountId: expense.accountId ?? "",
      note: expense.note,
      repeat: "none",
      active: true,
    };
  }
  if (target.kind === "rule") {
    const { rule } = target;
    return {
      title: rule.title,
      amount: centsToInput(rule.totalCents),
      date: rule.nextDate,
      category: rule.category.name,
      payerUserId: rule.payerUserId,
      splitMode: rule.splitMode,
      ...allocationInputs(rule.allocations),
      accountId: rule.accountId ?? "",
      note: rule.note,
      repeat: rule.frequency,
      active: rule.active,
    };
  }
  return {
    title: "",
    amount: "",
    date: localDate(),
    category: fallbackCategory,
    payerUserId: meId ?? "",
    splitMode: "equal",
    exact: {},
    percent: {},
    accountId: "",
    note: "",
    repeat: "none",
    active: true,
  };
}

/**
 * Add or edit a shared expense, or edit a repeating one (cards `iphone-shared-expense-add`,
 * `iphone-split`; specimens `shared-expense`, `shared-split`, `shared-payer`). The preview mirrors
 * the server's split rules; the server validates and computes the stored shares. On any failure
 * the dialog stays open with the draft. A stale edit (409) keeps the draft and lets the person
 * keep their changes on top of the latest version or take the latest.
 */
export function ExpenseFormDialog({ view, target, onClose }: { view: HouseholdView; target: FormTarget; onClose: () => void }) {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const toast = useToast();
  const choices = useLedgerChoices();
  // Inline category creation (MAZ-89): saved to the personal ledger, then chosen here; the draft stays.
  const workspace = useLedgerWorkspace();
  const [creatingCategory, setCreatingCategory] = useState(false);
  const meId = view.who.meId;
  const [draft, setDraft] = useState<Draft>(() => draftFrom(target, meId, choices.categories[0]?.name ?? "Other"));
  const [revision, setRevision] = useState(target.kind === "edit" ? target.expense.revision : target.kind === "rule" ? target.rule.revision : 0);
  const [conflict, setConflict] = useState<{ title: string; totalCents: number; payerUserId: string; revision: number; source: SharedExpense | SharedRecurring } | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const titleRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const payerRef = useRef<HTMLFieldSetElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const ids = { title: useId(), amount: useId(), date: useId(), category: useId(), account: useId(), note: useId(), repeat: useId(), error: useId(), splitStatus: useId() };

  const paid = target.kind === "edit" && isPaid(target.expense);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => { setDraft((previous) => ({ ...previous, [key]: value })); };

  // Who the expense is split among: paid expenses keep their participants; rules use the current
  // members; others, the members active on the chosen date (server rule, previewed here).
  const participants: HouseholdMember[] = paid
    ? view.detail.members.filter((member) => target.expense.splits.some((split) => split.userId === member.userId))
    : target.kind === "rule" || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)
      ? view.detail.members.filter(isCurrent)
      : eligibleMembers(view.detail, draft.date);
  const participantIds = participants.map((member) => member.userId);

  const totalCents = parseAmount(draft.amount);
  const preview = (() => {
    if (totalCents === null || totalCents < 1 || !participantIds.length) return null;
    if (draft.splitMode === "equal") return { shares: equalSplit(totalCents, participantIds), status: "ok" as const };
    if (draft.splitMode === "exact") {
      const amounts = participantIds.map((userId) => ({ userId, amountCents: parseAmount(draft.exact[userId] ?? "0") }));
      if (amounts.some((item) => item.amountCents === null)) return { shares: null, status: "invalid" as const };
      const sum = amounts.reduce((acc, item) => acc + (item.amountCents ?? 0), 0);
      return { shares: amounts as { userId: string; amountCents: number }[], status: sum === totalCents ? ("ok" as const) : ("off" as const), left: totalCents - sum };
    }
    const points = participantIds.map((userId) => ({ userId, percentBasisPoints: parsePercent(draft.percent[userId] ?? "0") }));
    if (points.some((item) => item.percentBasisPoints === null)) return { shares: null, status: "invalid" as const };
    const sum = points.reduce((acc, item) => acc + (item.percentBasisPoints ?? 0), 0);
    return sum === 10_000
      ? { shares: percentSplit(totalCents, points as { userId: string; percentBasisPoints: number }[]), status: "ok" as const }
      : { shares: null, status: "off" as const, leftPoints: 10_000 - sum };
  })();
  const myShare = meId && preview?.shares ? (preview.shares.find((share) => share.userId === meId)?.amountCents ?? 0) : null;

  const categories: SharedCategory[] = useMemo(() => {
    const list = [...choices.categories];
    const existing = target.kind === "edit" ? target.expense.category : target.kind === "rule" ? target.rule.category : null;
    if (existing && !list.some((category) => category.name === existing.name)) list.unshift(existing);
    return list;
  }, [choices.categories, target]);

  const save = useMutation({
    mutationKey: ["households", "expense", "save"],
    mutationFn: async ({ input, date, repeat, active, revision: base }: { input: Base; date: string; repeat: Repeat; active: boolean; revision: number }) => {
      if (target.kind === "edit") return updateExpense(view.householdId, target.expense.id, { ...input, date, revision: base });
      if (target.kind === "rule") {
        return updateRule(view.householdId, target.rule.id, { ...input, nextDate: date, frequency: repeat === "none" ? target.rule.frequency : repeat, active, revision: base });
      }
      if (repeat !== "none") return createRule(view.householdId, { ...input, nextDate: date, frequency: repeat });
      return createExpense(view.householdId, { ...input, date });
    },
    onSuccess: async () => {
      await refreshHousehold(queryClient, email, view.householdId);
      const month = draft.date.slice(0, 7);
      toast.show(
        target.kind === "new"
          ? draft.repeat === "none"
            ? { title: `${draft.title.trim()} added`, detail: month === view.month ? "Everyone in the household sees it." : `Added to ${monthLabel(month)}.` }
            : { title: `${draft.title.trim()} repeats ${draft.repeat}`, detail: "Penny adds each occurrence on its date." }
          : { title: "Changes saved", detail: "Everyone sees the update." },
      );
      onClose();
    },
    onError: async (error) => {
      if (!(error instanceof ApiError) || error.status !== 409) return;
      // A stale revision: fetch the latest so the person can decide. Their draft stays as typed.
      if (target.kind === "edit" && /changed/i.test(error.message)) {
        const latest = await queryClient.query({ ...expenseQuery(email, view.householdId, target.expense.id), staleTime: 0 }).catch(() => null);
        if (latest) setConflict({ title: latest.title, totalCents: latest.totalCents, payerUserId: latest.payerUserId, revision: latest.revision, source: latest });
      } else if (target.kind === "rule" && /changed/i.test(error.message)) {
        const rules = await queryClient.query({ ...recurringQuery(email, view.householdId), staleTime: 0 }).catch(() => null);
        const latest = rules?.find((rule) => rule.id === target.rule.id);
        if (latest) setConflict({ title: latest.title, totalCents: latest.totalCents, payerUserId: latest.payerUserId, revision: latest.revision, source: latest });
      }
    },
  });

  function validate(): { errors: Partial<Record<Field, string>>; input?: Base } {
    const found: Partial<Record<Field, string>> = {};
    const title = draft.title.trim();
    if (!title || title.length > 100) found.title = "Enter a title of up to 100 characters.";
    if (totalCents === null || totalCents < 1 || totalCents > MAX_CENTS) found.amount = "Enter an amount above zero with up to two decimal places.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || draft.date < "2000-01-01" || draft.date > "2100-12-31") found.date = "Choose a date between 2000 and 2100.";
    else if (paid && draft.date.slice(0, 7) !== target.expense.date.slice(0, 7)) found.date = `A share is already repaid, so the date must stay in ${monthLabel(target.expense.date.slice(0, 7))}.`;
    if (!participantIds.length) found.split = "Nobody in this household was a member on that date. Choose a later date.";
    else if (!participantIds.includes(draft.payerUserId)) found.payer = "Choose who paid. They must be a member on the expense date.";
    if (!found.split && totalCents !== null && preview) {
      if (preview.status === "invalid") found.split = draft.splitMode === "exact" ? "Enter each share as an amount with up to two decimals." : "Enter each share as a percentage with up to two decimals.";
      else if (preview.status === "off") {
        found.split =
          draft.splitMode === "exact"
            ? `Shares must add up to ${view.money(totalCents)}. ${view.money(Math.abs(preview.left ?? 0))} ${(preview.left ?? 0) > 0 ? "left to assign" : "too much"}.`
            : `Percentages must add up to 100%. ${pointsToInput(Math.abs(preview.leftPoints ?? 0))}% ${(preview.leftPoints ?? 0) > 0 ? "left" : "too much"}.`;
      }
    }
    if (Object.keys(found).length || totalCents === null) return { errors: found };
    const category = categories.find((item) => item.name === draft.category) ?? categories[0] ?? { name: "Other", icon: "pricetag", color: "#8E8E93" };
    const allocations: Allocation[] | undefined =
      draft.splitMode === "exact"
        ? participantIds.map((userId) => ({ userId, amountCents: parseAmount(draft.exact[userId] ?? "0") ?? 0 }))
        : draft.splitMode === "percent"
          ? participantIds.map((userId) => ({ userId, percentBasisPoints: parsePercent(draft.percent[userId] ?? "0") ?? 0 }))
          : undefined;
    const existingReceipt = target.kind === "edit" ? target.expense.receiptId : target.kind === "rule" ? target.rule.receiptId : undefined;
    // Only the payer chooses their own private account; anyone else's edit leaves it to the server.
    const account = draft.payerUserId === meId && draft.accountId ? { accountId: draft.accountId } : {};
    return {
      errors: {},
      input: {
        title,
        totalCents,
        payerUserId: draft.payerUserId,
        splitMode: draft.splitMode,
        ...(allocations ? { allocations } : {}),
        category: { name: category.name, icon: category.icon, color: category.color },
        note: draft.note.trim(),
        ...account,
        ...(existingReceipt ? { receiptId: existingReceipt } : {}),
        timezoneOffsetMinutes: timezoneOffsetMinutes(),
      },
    };
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (save.isPending) return;
    const result = validate();
    setErrors(result.errors);
    const first = (["title", "amount", "date", "payer", "split"] as const).find((field) => result.errors[field]);
    if (first) {
      if (first === "title") titleRef.current?.focus();
      else if (first === "amount") amountRef.current?.focus();
      else if (first === "date") dateRef.current?.focus();
      else if (first === "payer") payerRef.current?.querySelector<HTMLInputElement>("input:not([disabled])")?.focus();
      else (splitRef.current?.querySelector<HTMLInputElement>("input[type=text]:not([disabled]), input[inputmode]:not([disabled])") ?? splitRef.current)?.focus();
      return;
    }
    if (result.input) save.mutate({ input: result.input, date: draft.date, repeat: draft.repeat, active: draft.active, revision });
  }

  const describe = (field: Field) => (errors[field] ? { "aria-invalid": true as const, "aria-describedby": `${ids.error}-${field}` } : {});
  const errorText = (field: Field) =>
    errors[field] ? (
      <span id={`${ids.error}-${field}`} className="form-error">
        {errors[field]}
      </span>
    ) : null;
  const failure = save.isError && !conflict ? describeSharedError(save.error) : null;
  const retryable = failure && (failure.kind === "offline" || failure.kind === "unreachable" || failure.kind === "other");
  const title = target.kind === "new" ? "New shared expense" : target.kind === "rule" ? "Edit repeating expense" : "Edit expense";
  const payerIsMe = meId !== undefined && draft.payerUserId === meId;

  return (
    <Dialog title={title} description={`${view.detail.household.name} · everyone sees the full total; reports count only each person's share.`} onClose={onClose} initialFocus={paid ? titleRef : amountRef} wide>
      <form className="form" onSubmit={onSubmit} noValidate aria-label={title}>
        {conflict ? (
          <Banner
            tone="error"
            title="Someone else changed this while you were editing"
            action={
              <span className="shared-actions">
                <Button
                  onClick={() => {
                    setRevision(conflict.revision);
                    setConflict(null);
                    save.reset();
                  }}
                >
                  Keep my changes
                </Button>
                <Button
                  variant="quiet"
                  onClick={() => {
                    const next: FormTarget = "nextDate" in conflict.source ? { kind: "rule", rule: conflict.source } : { kind: "edit", expense: conflict.source };
                    setDraft(draftFrom(next, meId, draft.category));
                    setRevision(conflict.revision);
                    setConflict(null);
                    save.reset();
                  }}
                >
                  Use their version
                </Button>
              </span>
            }
          >
            Nothing was saved and your changes are still here. Their version: {conflict.title}, {view.money(conflict.totalCents)}, paid by {view.who.name(conflict.payerUserId)}. Keep my changes saves yours over it
            when you press Save.
          </Banner>
        ) : null}
        {failure ? <SaveErrorBanner message={failure.message} {...(retryable && save.variables ? { onRetry: () => { save.mutate(save.variables); }, retrying: save.isPending } : {})} /> : null}
        {paid ? <p className="note">A share of this expense is already repaid, so its payer, total, month and shares can't change. You can still edit the title, category, note and day.</p> : null}

        <div className="form-grid">
          <div className="form-field form-amount">
            <label htmlFor={ids.amount}>Total ({view.currency})</label>
            <input
              id={ids.amount}
              ref={amountRef}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={draft.amount}
              disabled={paid}
              onChange={(event) => { set("amount", event.currentTarget.value); }}
              {...describe("amount")}
            />
            {errorText("amount")}
          </div>
          <div className="form-field">
            <label htmlFor={ids.title}>Title</label>
            <input id={ids.title} ref={titleRef} maxLength={100} autoComplete="off" value={draft.title} onChange={(event) => { set("title", event.currentTarget.value); }} {...describe("title")} />
            {errorText("title")}
          </div>
        </div>
        <div className="form-grid">
          <div className="form-field">
            <label htmlFor={ids.date}>{target.kind === "rule" ? "Next date" : "Date"}</label>
            <input id={ids.date} ref={dateRef} type="date" min="2000-01-01" max="2100-12-31" value={draft.date} onChange={(event) => { set("date", event.currentTarget.value); }} {...describe("date")} />
            {errorText("date")}
          </div>
          <div className="form-field">
            <label htmlFor={ids.category}>Category</label>
            <select id={ids.category} value={categories.some((item) => item.name === draft.category) ? draft.category : (categories[0]?.name ?? "")} onChange={(event) => { set("category", event.currentTarget.value); }}>
              {categories.map((category) => (
                <option key={category.name} value={category.name}>
                  {category.name}
                </option>
              ))}
            </select>
            {workspace.ledger ? (
              <Button
                variant="quiet"
                icon="add"
                className="inline-create"
                onClick={() => {
                  setCreatingCategory(true);
                }}
              >
                New category
              </Button>
            ) : null}
          </div>
          {target.kind !== "edit" ? (
            <div className="form-field">
              <label htmlFor={ids.repeat}>Repeat</label>
              <select id={ids.repeat} value={draft.repeat} onChange={(event) => { set("repeat", event.currentTarget.value as Repeat); }}>
                {target.kind === "new" ? <option value="none">Doesn't repeat</option> : null}
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
          ) : null}
        </div>
        {draft.repeat !== "none" ? <p className="note">Penny adds each occurrence on its date, starting {draft.date || "on the date above"}, split among the members active then.</p> : null}
        {target.kind === "rule" ? <SwitchRow label="Active" description="A paused repeating expense adds nothing until you resume it." checked={draft.active} onChange={(value) => { set("active", value); }} /> : null}

        <fieldset className="choices" ref={payerRef} disabled={paid} {...(errors.payer ? { "aria-describedby": `${ids.error}-payer` } : {})}>
          <legend className="choices__legend">Paid by</legend>
          <div className="choices__options">
            {participants.map((member) => (
              <label key={member.userId} className={draft.payerUserId === member.userId ? "choice choice--on wbtn" : "choice wbtn"}>
                <input
                  type="radio"
                  name="payer"
                  value={member.userId}
                  checked={draft.payerUserId === member.userId}
                  onChange={() => {
                    setDraft((previous) => ({ ...previous, payerUserId: member.userId, accountId: member.userId === meId ? previous.accountId : "" }));
                  }}
                />
                <Avatar name={member.email} size={22} />
                <span className="choice__label">{member.userId === meId ? "You" : member.email}</span>
              </label>
            ))}
          </div>
          {errorText("payer")}
        </fieldset>

        {payerIsMe && choices.accounts.length ? (
          <div className="form-field">
            <label htmlFor={ids.account}>Your account</label>
            <select id={ids.account} value={draft.accountId} onChange={(event) => { set("accountId", event.currentTarget.value); }} aria-describedby={`${ids.account}-hint`}>
              <option value="">No account</option>
              {choices.accounts.map((account) => (
                // The server checks the account against its copy of your ledger, so one added on
                // this device is shown but can't be chosen until it has synced.
                <option key={account.id} value={account.id} disabled={!account.synced}>
                  {account.synced ? account.name : `${account.name} (waiting to sync)`}
                </option>
              ))}
            </select>
            <span id={`${ids.account}-hint`} className="form-hint">
              Private: only you see which account you paid from.
              {choices.accounts.some((account) => !account.synced) ? " Accounts added on this device can be chosen once they've synced." : null}
            </span>
          </div>
        ) : !payerIsMe ? (
          <p className="note">{view.who.name(draft.payerUserId)} chooses their own payment account; nobody else sees it.</p>
        ) : null}

        <div ref={splitRef} tabIndex={-1} className="shared-section">
          <ChoiceGroup<SplitMode>
            legend="Split"
            name="split-mode"
            value={draft.splitMode}
            onChange={(mode) => {
              if (!paid) set("splitMode", mode);
            }}
            options={[
              { value: "equal", label: "Equally", disabled: paid },
              { value: "exact", label: "Amounts", disabled: paid },
              { value: "percent", label: "Percent", disabled: paid },
            ]}
          />
          <ul className="split-rows" aria-label="Shares">
            {participants.map((member) => {
              const share = preview?.shares?.find((item) => item.userId === member.userId)?.amountCents;
              const name = member.userId === meId ? "You" : member.email;
              return (
                <li key={member.userId} className="split-row">
                  <Avatar name={member.email} size={28} />
                  <span className="split-row__name">{name}</span>
                  {draft.splitMode === "equal" ? (
                    <span className="split-row__amount pk-num">{share === undefined ? "—" : view.money(share)}</span>
                  ) : draft.splitMode === "exact" ? (
                    <input
                      aria-label={`${member.userId === meId ? "Your" : `${name}'s`} share in ${view.currency}`}
                      inputMode="decimal"
                      placeholder="0.00"
                      disabled={paid}
                      value={draft.exact[member.userId] ?? ""}
                      aria-invalid={errors.split ? true : undefined}
                      aria-describedby={ids.splitStatus}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setDraft((previous) => ({ ...previous, exact: { ...previous.exact, [member.userId]: value } }));
                      }}
                    />
                  ) : (
                    <span className="shared-actions" style={{ flexWrap: "nowrap" }}>
                      <input
                        aria-label={`${member.userId === meId ? "Your" : `${name}'s`} share in percent`}
                        inputMode="decimal"
                        placeholder="0"
                        disabled={paid}
                        value={draft.percent[member.userId] ?? ""}
                        aria-invalid={errors.split ? true : undefined}
                        aria-describedby={ids.splitStatus}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setDraft((previous) => ({ ...previous, percent: { ...previous.percent, [member.userId]: value } }));
                        }}
                      />
                      <span aria-hidden="true">%</span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <div id={ids.splitStatus} className="split-total" role="status">
            {splitStatusText(draft.splitMode, preview, totalCents, view.money)}
          </div>
          {errorText("split")}
          {target.kind !== "rule" && !view.detail.household.trip ? (
            <p className="note">Split among the members on {draft.date ? "that date" : "the expense date"}. People who join later aren't included.</p>
          ) : null}
        </div>

        {myShare !== null && participantIds.includes(meId ?? "") ? (
          <div className="your-share" role="status">
            <span>Your share · in your spending</span>
            <span className="pk-num">{view.money(myShare)}</span>
          </div>
        ) : null}

        <div className="form-field">
          <label htmlFor={ids.note}>Note</label>
          <textarea id={ids.note} maxLength={1000} value={draft.note} onChange={(event) => { set("note", event.currentTarget.value); }} />
        </div>

        <div className="form-actions">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={save.isPending || conflict !== null}>
            {save.isPending ? "Saving…" : target.kind === "new" ? (draft.repeat === "none" ? "Add expense" : "Save repeating expense") : "Save"}
          </Button>
        </div>
      </form>
      {creatingCategory && workspace.ledger ? (
        <CategoryFormDialog
          workspace={{ ledger: workspace.ledger, save: workspace.save }}
          initialKind="expense"
          fixedKind
          onSaved={(category) => {
            set("category", category.name);
          }}
          onClose={() => {
            setCreatingCategory(false);
          }}
        />
      ) : null}
    </Dialog>
  );
}

function splitStatusText(
  mode: SplitMode,
  preview: { status: "ok" | "off" | "invalid"; left?: number; leftPoints?: number } | null,
  total: number | null,
  money: (cents: number) => string,
): string {
  if (total === null || total < 1) return "Enter the total to see each share.";
  if (!preview) return "Nobody to split with on this date.";
  if (preview.status === "invalid") return "Some shares aren't valid numbers yet.";
  if (mode === "equal") return `Split equally: ${money(total)}. Leftover cents go to the first members.`;
  if (mode === "exact") {
    const left = preview.left ?? 0;
    return preview.status === "ok" ? `Adds up to ${money(total)}.` : left > 0 ? `${money(left)} left to assign of ${money(total)}.` : `${money(-left)} more than ${money(total)}.`;
  }
  const left = preview.leftPoints ?? 0;
  return preview.status === "ok" ? "Adds up to 100%." : left > 0 ? `${pointsToInput(left)}% left to assign.` : `${pointsToInput(-left)}% over 100%.`;
}
