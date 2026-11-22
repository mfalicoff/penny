import type { Category, Receipt } from "@domain/ledger.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useRef, useState, type KeyboardEvent, type SyntheticEvent } from "react";
import { ApiError } from "../../api/client";
import { createExpense, createRule, expenseQuery, recurringQuery, refreshHousehold, timezoneOffsetMinutes, updateExpense, updateRule } from "../../api/households";
import type { Allocation, ExpenseInput, Frequency, HouseholdMember, SharedCategory, SharedExpense, SharedRecurring, SplitMode } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";
import { Avatar, Button, ChoiceGroup, cx, Kbd, SwitchRow } from "../../design/controls";
import { tileStyle } from "../../design/categoryTint";
import { Icon } from "../../design/Icon";
import { Banner, SaveErrorBanner, useToast } from "../../design/states";
import { categoryIcon, frequentCategories, mostUsedCategories } from "../entries/model";
import { CategoryPickerDialog } from "../entries/pickers";
import { AmountHero, DateRowInput, DetailList, DetailRow, EntryDialog, isMac, useEntryLayout } from "../entries/EntryParts";
import { HouseholdField, type EntrySeed, type HouseholdScope } from "../entries/scope";
import { ReceiptField } from "../receipts/ReceiptField";
import { useLedgerWorkspace } from "../organize/workspace";
import type { HouseholdView } from "./context";
import { useLedgerChoices, type LedgerAccountChoice } from "./choices";
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
  /** The linked receipt; a repeating expense knows only its id. */
  receipt: Receipt | null;
}

/** A receipt known only by id (repeating expenses): the preview reads its name and type from the file. */
const receiptById = (id: string | undefined): Receipt | null => (id ? { id, name: "", mime: "", uri: `/api/receipts/${id}` } : null);

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

function draftFrom(target: FormTarget, meId: string | undefined, fallbackCategory: string, seed?: EntrySeed, accounts: readonly LedgerAccountChoice[] = []): Draft {
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
      receipt: expense.receipt ?? receiptById(expense.receiptId),
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
      receipt: receiptById(rule.receiptId),
    };
  }
  // A new expense, possibly carrying what was typed in the personal form (Add entry's Household).
  // The viewer pays, so their account carries over once the server has it.
  const account = seed?.accountId && accounts.some((item) => item.id === seed.accountId && item.synced) ? seed.accountId : "";
  return {
    title: seed?.title ?? "",
    amount: seed?.amount ?? "",
    date: seed?.date ?? localDate(),
    category: seed?.categoryName ?? fallbackCategory,
    payerUserId: meId ?? "",
    splitMode: "equal",
    exact: {},
    percent: {},
    accountId: account,
    note: seed?.note ?? "",
    repeat: "none",
    active: true,
    receipt: seed?.receipt ?? null,
  };
}

/**
 * Add or edit a shared expense, or edit a repeating one (cards `iphone-shared-expense-add`,
 * `iphone-split`; specimens `shared-expense`, `shared-split`, `shared-payer`), in the card's order:
 * the amount; the title with the category as a pill in its field (it opens every category); Paid by
 * as filled pills; the split mode and each person's share, checked as included; your share; then
 * Date, your account and the "Receipt, repeat, note" row, which opens repeat, note and receipt in
 * place (MAZ-278). Save is in the footer (also ⌘↵ or Ctrl+Enter). A new one opened from Add entry (`scope`) also shows the type
 * and Household, so it can go back to being a personal entry without losing what was typed.
 *
 * The preview mirrors the server's split rules; the server validates and computes the stored
 * shares. On any failure the dialog stays open with the draft. A stale edit (409) keeps the draft
 * and lets the person keep their changes on top of the latest version or take the latest.
 */
export function ExpenseFormDialog({
  view,
  target,
  onClose,
  seed,
  scope,
}: {
  view: HouseholdView;
  target: FormTarget;
  onClose: () => void;
  /** What was typed in the personal form before switching here. */
  seed?: EntrySeed;
  /** Add entry's type and Household choice (new expenses only). */
  scope?: HouseholdScope;
}) {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const toast = useToast();
  const choices = useLedgerChoices();
  // Categories come from the personal ledger; All categories can create one there (MAZ-89), then it is chosen here and the draft stays.
  const workspace = useLedgerWorkspace();
  const [picking, setPicking] = useState(false);
  const meId = view.who.meId;
  const [draft, setDraft] = useState<Draft>(() => draftFrom(target, meId, choices.categories[0]?.name ?? "Other", seed, choices.accounts));
  const [more, setMore] = useState(() => target.kind === "rule" || Boolean(draft.note || draft.receipt));
  const [revision, setRevision] = useState(target.kind === "edit" ? target.expense.revision : target.kind === "rule" ? target.rule.revision : 0);
  const [conflict, setConflict] = useState<{ title: string; totalCents: number; payerUserId: string; revision: number; source: SharedExpense | SharedRecurring } | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [receiptWait, setReceiptWait] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const payerRef = useRef<HTMLFieldSetElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const layout = useEntryLayout();
  const ids = { form: useId(), title: useId(), amount: useId(), date: useId(), category: useId(), account: useId(), note: useId(), repeat: useId(), more: useId(), error: useId(), splitStatus: useId(), splitWho: useId() };

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

  // Every category picker choice: the ledger's expense categories, most used first.
  const ledgerCategories: Category[] = useMemo(() => (workspace.ledger ? frequentCategories(workspace.ledger, "expense") : []), [workspace.ledger]);

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
    const known = [...ledgerCategories, ...categories];
    const match = known.find((item) => item.name === draft.category) ?? categories[0] ?? { name: "Other", icon: "pricetag", color: "#8E8E93" };
    const category = { name: match.name, icon: match.icon, color: match.color };
    const allocations: Allocation[] | undefined =
      draft.splitMode === "exact"
        ? participantIds.map((userId) => ({ userId, amountCents: parseAmount(draft.exact[userId] ?? "0") ?? 0 }))
        : draft.splitMode === "percent"
          ? participantIds.map((userId) => ({ userId, percentBasisPoints: parsePercent(draft.percent[userId] ?? "0") ?? 0 }))
          : undefined;
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
        ...(draft.receipt ? { receiptId: draft.receipt.id } : {}),
        timezoneOffsetMinutes: timezoneOffsetMinutes(),
      },
    };
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    submit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    // ⌘↵ / Ctrl+Enter saves from any field, as in the personal form.
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && event.currentTarget.contains(event.target as Node)) {
      event.preventDefault();
      submit();
    }
  }

  /** What this draft carries back to the personal form. */
  function seedFromDraft(): EntrySeed {
    return {
      amount: draft.amount,
      title: draft.title,
      date: draft.date,
      categoryName: draft.category,
      accountId: draft.payerUserId === meId ? draft.accountId : "",
      note: draft.note,
      receipt: draft.receipt,
    };
  }

  function submit() {
    if (save.isPending || conflict) return;
    if (receiptBusy) {
      setReceiptWait(true);
      return;
    }
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
  const isNew = target.kind === "new";
  const title = isNew ? "New expense" : target.kind === "rule" ? "Edit repeating expense" : "Edit expense";
  const payerIsMe = meId !== undefined && draft.payerUserId === meId;
  const chosenChip = ledgerCategories.find((category) => category.name === draft.category);
  const chosenCategory: SharedCategory | undefined = chosenChip ?? categories.find((category) => category.name === draft.category);
  const pillTint = tileStyle({ id: chosenChip?.id, color: chosenCategory?.color });
  // Card `.note .pill`: the category sits in the title field, tinted with its color. It opens every
  // category, where one can also be made; until the ledger has loaded it's a menu of the known ones.
  const categoryPill = workspace.ledger ? (
    <button type="button" id={ids.category} className="category-pill" style={pillTint} aria-haspopup="dialog" aria-label={`Category: ${draft.category}`} onClick={() => { setPicking(true); }}>
      <Icon name={categoryIcon(chosenCategory?.icon)} size={15} weight={44} />
      <span className="category-pill__name">{draft.category}</span>
    </button>
  ) : (
    <span className="category-pill" style={pillTint}>
      <Icon name={categoryIcon(chosenCategory?.icon)} size={15} weight={44} />
      <span className="category-pill__name" aria-hidden="true">
        {draft.category}
      </span>
      <select id={ids.category} aria-label="Category" value={draft.category} onChange={(event) => { set("category", event.currentTarget.value); }}>
        {categories.map((category) => (
          <option key={category.name} value={category.name}>
            {category.name}
          </option>
        ))}
      </select>
    </span>
  );
  const newScope = isNew ? scope : undefined;

  const notices = (
    <>
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
    </>
  );
  const hasNotices = conflict !== null || failure !== null || paid;
  const account = payerIsMe && choices.accounts.length ? (
    <select id={ids.account} className="entry-row__select" value={draft.accountId} onChange={(event) => { set("accountId", event.currentTarget.value); }} aria-describedby={`${ids.account}-hint`}>
      <option value="">None</option>
      {choices.accounts.map((account) => (
        // The server checks the account against its copy of your ledger, so one added on
        // this device is shown but can't be chosen until it has synced.
        <option key={account.id} value={account.id} disabled={!account.synced}>
          {account.synced ? account.name : `${account.name} (waiting to sync)`}
        </option>
      ))}
    </select>
  ) : null;

  return (
    <EntryDialog
      layout={layout}
      title={title}
      subtitle={view.detail.household.name}
      onClose={onClose}
      initialFocus={paid ? titleRef : amountRef}
      form={{ id: ids.form, onSubmit, "aria-label": title }}
      onKeyDown={onKeyDown}
      {...(hasNotices ? { notices } : {})}
      secondary={
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      }
      primary={
        <Button type="submit" form={ids.form} variant="primary" busy={save.isPending || conflict !== null} aria-keyshortcuts="Meta+Enter Control+Enter">
          {save.isPending ? "Saving…" : isNew ? "Add expense" : "Save"}
          {layout === "desktop" ? <Kbd>{isMac() ? "⌘↵" : "Ctrl ↵"}</Kbd> : null}
        </Button>
      }
      main={
        <>
          <AmountHero id={ids.amount} inputRef={amountRef} value={draft.amount} onChange={(value) => { set("amount", value); }} currency={view.currency} kind="expense" currencyPill={false} disabled={paid} invalid={describe("amount")} error={errorText("amount")} />
          <div className="entry-title entry-title--category">
            <label htmlFor={ids.title} className="visually-hidden">
              Title
            </label>
            <div className="entry-title__field">
              <input id={ids.title} ref={titleRef} maxLength={100} autoComplete="off" placeholder="Title" value={draft.title} onChange={(event) => { set("title", event.currentTarget.value); }} {...describe("title")} />
              {categoryPill}
            </div>
            {errorText("title")}
          </div>
        </>
      }
      details={
        <>
          <fieldset className="choices payer-pills" ref={payerRef} disabled={paid} {...(errors.payer ? { "aria-describedby": `${ids.error}-payer` } : {})}>
            <legend className="entry-label">Paid by</legend>
            <div className="payer-pills__row">
              {participants.map((member) => {
                const on = draft.payerUserId === member.userId;
                return (
                  <label key={member.userId} className={cx("payer-pill", on && "payer-pill--on")}>
                    <input
                      type="radio"
                      name="payer"
                      value={member.userId}
                      checked={on}
                      onChange={() => {
                        setDraft((previous) => ({ ...previous, payerUserId: member.userId, accountId: member.userId === meId ? previous.accountId : "" }));
                      }}
                    />
                    <Avatar name={member.email} size={26} />
                    <span className="payer-pill__name">{member.userId === meId ? "You" : member.email}</span>
                  </label>
                );
              })}
            </div>
            {errorText("payer")}
          </fieldset>

          <div ref={splitRef} tabIndex={-1} className="shared-section shared-split">
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
            {/* Card `.alloc`: everyone on the expense's date is in the split, so each row is checked. */}
            <ul className="split-rows split-rows--card" aria-label="Shares" aria-describedby={ids.splitWho}>
              {participants.map((member) => {
                const share = preview?.shares?.find((item) => item.userId === member.userId)?.amountCents;
                const name = member.userId === meId ? "You" : member.email;
                return (
                  <li key={member.userId} className="split-row split-row--checked">
                    <span className="split-row__check" aria-hidden="true">
                      <Icon name="checkmark" size={14} weight={64} />
                    </span>
                    <Avatar name={member.email} size={30} />
                    <span className="split-row__name">{name}</span>
                    {draft.splitMode === "equal" ? (
                      <span className={cx("split-row__amount pk-num", member.userId === meId && "split-row__amount--me")}>{share === undefined ? "—" : view.money(share)}</span>
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
                      <span className="split-row__percent">
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
            <p id={ids.splitWho} className="visually-hidden">
              {splitWhoText(target.kind === "rule", view.detail.household.trip, totalCents)}
            </p>
            {/* Amounts and percentages say what's left to assign; an equal split needs no status (card). */}
            {draft.splitMode !== "equal" ? (
              <div id={ids.splitStatus} className="split-total" role="status">
                {splitStatusText(draft.splitMode, preview, totalCents, view.money)}
              </div>
            ) : null}
            {errorText("split")}
            {myShare !== null && participantIds.includes(meId ?? "") ? (
              <div className="your-share your-share--form" role="status">
                <span>
                  Your share <span className="your-share__hint">· in your spending</span>
                </span>
                <b className="your-share__amount pk-num">{view.money(myShare)}</b>
              </div>
            ) : null}
          </div>

          <DetailList>
            <DetailRow icon="calendar" label={target.kind === "rule" ? "Next date" : "Date"} htmlFor={ids.date} {...(layout === "desktop" ? { chevron: "down" as const } : {})}>
              <DateRowInput id={ids.date} inputRef={dateRef} value={draft.date} onChange={(value) => { set("date", value); }} today={localDate()} long={layout === "desktop"} invalid={describe("date")} />
            </DetailRow>
            {account ? (
              <DetailRow icon="card" label="Your account" htmlFor={ids.account} {...(layout === "desktop" ? { chevron: "down" as const } : {})}>
                {account}
              </DetailRow>
            ) : null}
            <button type="button" className="entry-row entry-row--button" aria-expanded={more} aria-controls={ids.more} onClick={() => { setMore((value) => !value); }}>
              <Icon name="ellipsis-horizontal" size={18} />
              <span className="entry-row__label">{target.kind === "edit" ? "Receipt, note" : "Receipt, repeat, note"}</span>
              <span className="entry-row__value">
                {moreSummary(draft, target.kind !== "edit")}
                <Icon name={more ? "chevron-down" : "chevron-forward"} size={13} weight={48} />
              </span>
            </button>
          </DetailList>
          {errorText("date")}
          {account ? (
            <span id={`${ids.account}-hint`} className="form-hint">
              Private: only you see which account you paid from.
              {choices.accounts.some((item) => !item.synced) ? " Accounts added on this device can be chosen once they've synced." : null}
            </span>
          ) : !payerIsMe ? (
            <p className="note">{view.who.name(draft.payerUserId)} chooses their own payment account; nobody else sees it.</p>
          ) : null}
          <div id={ids.more} className="more-details" hidden={!more}>
            {target.kind !== "edit" ? (
              <div className="form-grid">
                <div className="form-field">
                  <label htmlFor={ids.repeat}>Repeat</label>
                  <select id={ids.repeat} value={draft.repeat} onChange={(event) => { set("repeat", event.currentTarget.value as Repeat); }}>
                    {isNew ? <option value="none">Doesn't repeat</option> : null}
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
              </div>
            ) : null}
            {draft.repeat !== "none" ? <p className="note">Penny adds each occurrence on its date, starting {draft.date || "on the date above"}, split among the members active then.</p> : null}
            {target.kind === "rule" ? <SwitchRow label="Active" description="A paused repeating expense adds nothing until you resume it." checked={draft.active} onChange={(value) => { set("active", value); }} /> : null}
            <div className="form-field">
              <label htmlFor={ids.note}>Note</label>
              <textarea id={ids.note} maxLength={1000} value={draft.note} onChange={(event) => { set("note", event.currentTarget.value); }} />
            </div>
            <ReceiptField
              value={draft.receipt}
              onChange={(receipt) => {
                set("receipt", receipt);
              }}
              onBusyChange={(busy) => {
                setReceiptBusy(busy);
                if (!busy) setReceiptWait(false);
              }}
              hint="Everyone in the household can open it."
            />
            {receiptWait ? (
              <p className="form-error" role="alert">
                The receipt is still uploading. Wait for it to finish, or cancel the upload.
              </p>
            ) : null}
          </div>
          {newScope ? <section className="entry-section">{<HouseholdField scope={newScope} seed={seedFromDraft} />}</section> : null}
        </>
      }
    >
      {picking && workspace.ledger ? (
        <CategoryPickerDialog
          kind="expense"
          categories={ledgerCategories}
          mostUsed={mostUsedCategories(workspace.ledger, "expense")}
          selected={chosenChip?.id}
          save={workspace.save}
          onSelect={(_id, category) => {
            if (category) set("category", category.name);
          }}
          onClose={() => {
            setPicking(false);
          }}
        />
      ) : null}
    </EntryDialog>
  );
}


const REPEAT_LABELS: Record<Frequency, string> = { weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };

/** What the "Receipt, repeat, note" row holds, as in Add entry: "Receipt · Monthly · Note". */
function moreSummary(draft: Draft, repeats: boolean): string {
  const parts: string[] = [];
  if (draft.receipt) parts.push("Receipt");
  if (repeats && draft.repeat !== "none") parts.push(REPEAT_LABELS[draft.repeat]);
  if (draft.note.trim()) parts.push("Note");
  return parts.join(" · ");
}

/** Who the split includes, read with the shares (the card shows only the checked rows). */
function splitWhoText(rule: boolean, trip: unknown, total: number | null): string {
  const who = rule ? "Everyone in the household when each one is added is included." : trip ? "Everyone on the trip is included." : "Everyone who was a member on the expense date is included; people who join later aren't.";
  return total === null || total < 1 ? `${who} Enter the total to see each share.` : who;
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
