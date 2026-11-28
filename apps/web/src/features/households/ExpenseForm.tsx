import type { Category, Receipt } from "@domain/ledger.ts";
import { convertAmount, minorUnits, normalizeRate, parseAmount as parseMinor, type RateStatus } from "@domain/currency.ts";
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
import { categoryIcon, frequentCategories, minorToInput, mostUsedCategories } from "../entries/model";
import { fetchRates, isOffline, lastKnownRates } from "../../api/rates";
import { ConversionLine } from "../entries/ConversionLine";
import { CurrencyMenu } from "../entries/CurrencyMenu";
import { currencySymbolFor, currencyUses, displayRate, fitAmount, resolveRate, type AutoRate } from "../entries/currency";
import { RateNote, RateRow, useRateLookup, useShownRate, type RateMode } from "../entries/RateRow";
import { CategoryPickerDialog } from "../entries/pickers";
import { AmountHero, DateRowInput, DetailList, DetailRow, EntryDialog, isMac, useEntryLayout } from "../entries/EntryParts";
import { HouseholdField, type EntrySeed, type HouseholdScope } from "../entries/scope";
import { ReceiptField } from "../receipts/ReceiptField";
import { receiptExists } from "../../api/receipts";

/** The API's refusal of a receipt the household can't use (`SharedExpenseService.ReceiptUnavailable`). */
export const RECEIPT_GONE_NOTICE = "The receipt was no longer on the server, so it was saved without it.";
import { useLedgerWorkspace } from "../organize/workspace";
import type { HouseholdView } from "./context";
import { useLedgerChoices, type LedgerAccountChoice } from "./choices";
import { describeSharedError } from "./errors";
import { shake } from "../../design/motion";
import {
  eligibleMembers,
  equalSplit,
  isCurrent,
  isPaid,
  localDate,
  MAX_CENTS,
  memberName,
  monthLabel,
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
  /**
   * MAZ-151 phase 2: the currency the amount is typed in, null for the household's. Exact split
   * amounts stay in the household's currency.
   */
  currency: string | null;
  /** A typed (edited or manual) rate, household units per unit, or null for the looked-up one. */
  rateInput: string | null;
  /** An edited expense's own published or provisional rate, kept while its currency and date stay. */
  storedRate: { currency: string; date: string; rate: string; status: Exclude<RateStatus, "edited">; rateDate: string } | null;
}

/** A receipt known only by id (repeating expenses): the preview reads its name and type from the file. */
const receiptById = (id: string | undefined): Receipt | null => (id ? { id, name: "", mime: "", uri: `/api/receipts/${id}` } : null);

type Field = "title" | "amount" | "rate" | "date" | "payer" | "split";

/** A typed amount in `code`'s minor units, or null when it isn't one (the shared parsing rule). */
function parseIn(text: string, code: string): number | null {
  try {
    return parseMinor(text, code);
  } catch {
    return null;
  }
}

function validRateOrNull(value: string): string | null {
  try {
    return normalizeRate(value);
  } catch {
    return null;
  }
}

/** What expenses and repeating expenses share; the date field differs (`date` or `nextDate`). */
type Base = Omit<ExpenseInput, "date">;

function allocationInputs(code: string, allocations: readonly Allocation[] | undefined, splits?: readonly { userId: string; amountCents: number }[]) {
  const exact: Record<string, string> = {};
  const percent: Record<string, string> = {};
  for (const split of splits ?? []) exact[split.userId] = minorToInput(split.amountCents, code);
  for (const item of allocations ?? []) {
    if ("amountCents" in item) exact[item.userId] = minorToInput(item.amountCents, code);
    else percent[item.userId] = pointsToInput(item.percentBasisPoints);
  }
  return { exact, percent };
}

function draftFrom(target: FormTarget, meId: string | undefined, fallbackCategory: string, householdCurrency: string, seed?: EntrySeed, accounts: readonly LedgerAccountChoice[] = []): Draft {
  if (target.kind === "edit") {
    const { expense } = target;
    // Paid in another currency (contract 2.6.0): the amount is typed in it again, at its own rate.
    const original = expense.originalAmount !== undefined && expense.originalCurrency && expense.rate && expense.rateStatus ? { amount: expense.originalAmount, code: expense.originalCurrency, rate: expense.rate, status: expense.rateStatus } : null;
    return {
      title: expense.title,
      amount: original ? minorToInput(original.amount, original.code) : minorToInput(expense.totalCents, householdCurrency),
      currency: original?.code ?? null,
      rateInput: original?.status === "edited" ? original.rate : null,
      storedRate: original && original.status !== "edited" && expense.rateDate ? { currency: original.code, date: expense.date, rate: original.rate, status: original.status, rateDate: expense.rateDate } : null,
      date: expense.date,
      category: expense.category.name,
      payerUserId: expense.payerUserId,
      splitMode: expense.splitMode,
      ...allocationInputs(householdCurrency, expense.allocations, expense.splits),
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
      // Shared repeating expenses stay in the household's currency (MAZ-151 phase 2).
      amount: minorToInput(rule.totalCents, householdCurrency),
      currency: null,
      rateInput: null,
      storedRate: null,
      date: rule.nextDate,
      category: rule.category.name,
      payerUserId: rule.payerUserId,
      splitMode: rule.splitMode,
      ...allocationInputs(householdCurrency, rule.allocations),
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
  // What was typed in the personal form keeps its currency; the household's is the default.
  const seeded = seed?.currency && seed.currency !== householdCurrency ? seed.currency : null;
  return {
    title: seed?.title ?? "",
    amount: seed?.amount ?? "",
    currency: seeded,
    rateInput: null,
    storedRate: null,
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
 * as filled pills; the split mode and each person's share (everyone on the date is included); your share; then
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
  const [draft, setDraft] = useState<Draft>(() => draftFrom(target, meId, choices.categories[0]?.name ?? "Other", view.currency, seed, choices.accounts));
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
  const ids = { form: useId(), title: useId(), amount: useId(), rate: useId(), date: useId(), category: useId(), account: useId(), note: useId(), repeat: useId(), more: useId(), error: useId(), splitStatus: useId(), splitWho: useId() };

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

  // MAZ-151 phase 2: the amount may be typed in another currency than the household's, converted
  // at the rate for its date (household units per unit, `GET /api/rates` with the household's
  // currency as base), as the personal entry form does. Repeating expenses stay in the household's.
  const householdCurrency = view.currency;
  const code = draft.currency ?? householdCurrency;
  const foreign = code !== householdCurrency;
  const stored = foreign && draft.storedRate?.currency === code && draft.storedRate.date === draft.date ? draft.storedRate : null;
  const lookup = useRateLookup(householdCurrency, code, draft.date, foreign && !stored);
  const shownRate = useShownRate(lookup);
  const lookedUp: AutoRate | null = stored ? { rate: stored.rate, status: stored.status, rateDate: stored.rateDate, source: null, reason: stored.status === "provisional" ? "notYet" : null } : lookup.state === "rate" ? lookup.rate : null;
  const rateMode: RateMode = !foreign
    ? { mode: "loading" }
    : !lookedUp && lookup.state === "manual"
      ? { mode: "manual", reason: lookup.reason }
      : draft.rateInput !== null
        ? { mode: "edited", published: lookedUp }
        : lookedUp
          ? { mode: "auto", rate: lookedUp, refreshing: false }
          : shownRate.rate
            ? { mode: "auto", rate: shownRate.rate, refreshing: true }
            : { mode: "loading" };
  const conversionRate = !foreign ? null : draft.rateInput !== null ? validRateOrNull(draft.rateInput) : rateMode.mode === "auto" ? rateMode.rate.rate : null;
  const missingRate = foreign && conversionRate === null && (rateMode.mode === "manual" || rateMode.mode === "edited");
  const originalAmount = foreign ? parseIn(draft.amount, code) : null;
  // The total in the household's currency: what the splits, balances and the server use.
  const totalCents = !foreign ? parseIn(draft.amount, householdCurrency) : originalAmount !== null && conversionRate ? convertAmount(originalAmount, code, conversionRate, householdCurrency) : null;
  const splitAmount = (text: string) => parseIn(text, householdCurrency);
  const preview = (() => {
    if (totalCents === null || totalCents < 1 || !participantIds.length) return null;
    if (draft.splitMode === "equal") return { shares: equalSplit(totalCents, participantIds), status: "ok" as const };
    if (draft.splitMode === "exact") {
      const amounts = participantIds.map((userId) => ({ userId, amountCents: splitAmount(draft.exact[userId] ?? "0") }));
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
      const send = (body: Base) => {
        if (target.kind === "edit") return updateExpense(view.householdId, target.expense.id, { ...body, date, revision: base });
        if (target.kind === "rule") {
          return updateRule(view.householdId, target.rule.id, { ...body, nextDate: date, frequency: repeat === "none" ? target.rule.frequency : repeat, active, revision: base });
        }
        if (repeat !== "none") return createRule(view.householdId, { ...body, nextDate: date, frequency: repeat });
        return createExpense(view.householdId, { ...body, date });
      };
      try {
        await send(input);
        return { receiptDropped: false };
      } catch (error) {
        // A receipt kept in a draft longer than the server keeps unlinked uploads was cleaned up
        // (MAZ-199): save without it and say so. Any other answer, or a check that fails, keeps the refusal.
        const receiptId = input.receiptId;
        if (!receiptId || !(error instanceof ApiError) || !error.is("expense.receipt_unavailable")) throw error;
        if (await receiptExists(receiptId).catch(() => true)) throw error;
        const rest = { ...input };
        delete rest.receiptId;
        await send(rest);
        set("receipt", null);
        return { receiptDropped: true };
      }
    },
    onSuccess: async ({ receiptDropped }) => {
      await refreshHousehold(queryClient, email, view.householdId);
      const month = draft.date.slice(0, 7);
      const saved =
        target.kind === "new"
          ? draft.repeat === "none"
            ? { title: `${draft.title.trim()} added`, detail: month === view.month ? "Everyone in the household sees it." : `Added to ${monthLabel(month)}.` }
            : { title: `${draft.title.trim()} repeats ${draft.repeat}`, detail: "Penny adds each occurrence on its date." }
          : { title: "Changes saved", detail: "Everyone sees the update." };
      toast.show(receiptDropped ? { ...saved, detail: RECEIPT_GONE_NOTICE } : saved);
      onClose();
    },
    onError: async (error) => {
      if (!(error instanceof ApiError) || error.status !== 409) return;
      // A stale revision: fetch the latest so the person can decide. Their draft stays as typed.
      if (target.kind === "edit" && error.is("expense.changed")) {
        const latest = await queryClient.query({ ...expenseQuery(email, view.householdId, target.expense.id), staleTime: 0 }).catch(() => null);
        if (latest) setConflict({ title: latest.title, totalCents: latest.totalCents, payerUserId: latest.payerUserId, revision: latest.revision, source: latest });
      } else if (target.kind === "rule" && error.is("recurring.rule_changed")) {
        const rules = await queryClient.query({ ...recurringQuery(email, view.householdId), staleTime: 0 }).catch(() => null);
        const latest = rules?.find((rule) => rule.id === target.rule.id);
        if (latest) setConflict({ title: latest.title, totalCents: latest.totalCents, payerUserId: latest.payerUserId, revision: latest.revision, source: latest });
      }
    },
  });

  function validate(rate: AutoRate | null = lookedUp): { errors: Partial<Record<Field, string>>; input?: Base } {
    const found: Partial<Record<Field, string>> = {};
    const title = draft.title.trim();
    if (!title || title.length > 100) found.title = "Enter a title of up to 100 characters.";
    // The rate used: a typed one, else the looked-up (or the expense's own) one.
    let used: { rate: string; status: RateStatus; rateDate?: string } | null = null;
    if (foreign) {
      if (draft.rateInput !== null) {
        const typed = validRateOrNull(draft.rateInput);
        if (typed) used = { rate: typed, status: "edited" };
        else found.rate = "Enter the exchange rate.";
      } else if (rate) used = { rate: rate.rate, status: rate.status, rateDate: rate.rateDate };
      else found.rate = "Enter the exchange rate.";
    }
    const amountOf = (text: string) => parseIn(text, code);
    const typedAmount = amountOf(draft.amount);
    const total = !foreign ? typedAmount : typedAmount !== null && used ? convertAmount(typedAmount, code, used.rate, householdCurrency) : null;
    const units = minorUnits(code);
    if (typedAmount === null || typedAmount < 1 || typedAmount > MAX_CENTS) found.amount = units === 2 ? "Enter an amount above zero with up to two decimal places." : units === 0 ? "Enter a whole amount above zero." : "Enter an amount above zero with up to three decimal places.";
    else if (total !== null && (total < 1 || total > MAX_CENTS)) found.amount = `That's ${total < 1 ? "less than the smallest" : "more than the largest"} amount Penny can record in ${householdCurrency}.`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || draft.date < "2000-01-01" || draft.date > "2100-12-31") found.date = "Choose a date between 2000 and 2100.";
    else if (paid && draft.date.slice(0, 7) !== target.expense.date.slice(0, 7)) found.date = `A share is already repaid, so the date must stay in ${monthLabel(target.expense.date.slice(0, 7))}.`;
    if (!participantIds.length) found.split = "Nobody in this household was a member on that date. Choose a later date.";
    else if (!participantIds.includes(draft.payerUserId)) found.payer = "Choose who paid. They must be a member on the expense date.";
    if (!found.split && total !== null && totalCents !== null && preview) {
      if (preview.status === "invalid") found.split = draft.splitMode === "exact" ? "Enter each share as an amount with up to two decimals." : "Enter each share as a percentage with up to two decimals.";
      else if (preview.status === "off") {
        found.split =
          draft.splitMode === "exact"
            ? `Shares must add up to ${view.money(totalCents)}. ${view.money(Math.abs(preview.left ?? 0))} ${(preview.left ?? 0) > 0 ? "left to assign" : "too much"}.`
            : `Percentages must add up to 100%. ${pointsToInput(Math.abs(preview.leftPoints ?? 0))}% ${(preview.leftPoints ?? 0) > 0 ? "left" : "too much"}.`;
      }
    }
    if (Object.keys(found).length || total === null) return { errors: found };
    const known = [...ledgerCategories, ...categories];
    const match = known.find((item) => item.name === draft.category) ?? categories[0] ?? { name: "Other", icon: "pricetag", color: "#8E8E93" };
    const category = { name: match.name, icon: match.icon, color: match.color };
    const allocations: Allocation[] | undefined =
      draft.splitMode === "exact"
        ? participantIds.map((userId) => ({ userId, amountCents: splitAmount(draft.exact[userId] ?? "0") ?? 0 }))
        : draft.splitMode === "percent"
          ? participantIds.map((userId) => ({ userId, percentBasisPoints: parsePercent(draft.percent[userId] ?? "0") ?? 0 }))
          : undefined;
    // Only the payer chooses their own private account; anyone else's edit leaves it to the server.
    const account = draft.payerUserId === meId && draft.accountId ? { accountId: draft.accountId } : {};
    return {
      errors: {},
      input: {
        title,
        totalCents: total,
        // Contract 2.6.0: what was paid, when it isn't the household's currency (expenses only).
        ...(foreign && typedAmount !== null && used
          ? { originalAmount: typedAmount, originalCurrency: code, rate: used.rate, rateStatus: used.status, ...(used.rateDate !== undefined && used.status !== "edited" ? { rateDate: used.rateDate } : {}) }
          : {}),
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
    void submit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    // ⌘↵ / Ctrl+Enter saves from any field, as in the personal form.
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && event.currentTarget.contains(event.target as Node)) {
      event.preventDefault();
      void submit();
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
      currency: code,
    };
  }

  async function submit() {
    if (save.isPending || conflict) return;
    if (receiptBusy) {
      setReceiptWait(true);
      return;
    }
    let rate: AutoRate | null = lookedUp;
    if (foreign && !rate && draft.rateInput === null && lookup.state === "loading") {
      // The rate for a new date or currency is still on its way: wait for it rather than refuse.
      try {
        const answer = await fetchRates(queryClient, email, householdCurrency, draft.date);
        const found = resolveRate(code, { answer, offline: false, failed: false, cached: null });
        rate = found.state === "rate" ? found.rate : null;
      } catch (error) {
        const found = resolveRate(code, { offline: isOffline(error), failed: true, cached: lastKnownRates(householdCurrency) });
        rate = found.state === "rate" ? found.rate : null;
      }
    }
    const result = validate(rate);
    setErrors(result.errors);
    const first = (["title", "amount", "rate", "date", "payer", "split"] as const).find((field) => result.errors[field]);
    if (first) {
      if (first === "title") titleRef.current?.focus();
      else if (first === "amount") amountRef.current?.focus();
      else if (first === "rate") document.getElementById(ids.rate)?.focus();
      else if (first === "date") dateRef.current?.focus();
      else if (first === "payer") payerRef.current?.querySelector<HTMLInputElement>("input:not([disabled])")?.focus();
      else (splitRef.current?.querySelector<HTMLInputElement>("input[type=text]:not([disabled]), input[inputmode]:not([disabled])") ?? splitRef.current)?.focus();
      // docs/design/motion.md, Feedback: the refused field shakes (not under reduced motion); its error text says why.
      const focused = document.activeElement;
      if (focused instanceof HTMLElement) shake(focused.closest(".field, fieldset") ?? focused);
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
  // The currency menu (MAZ-151 phase 2): Suggested is the household's ("Lisbon's currency"), then your
  // home currency. Repeating expenses and repaid ones keep their currency.
  const home = workspace.ledger?.currency;
  const currencyControl =
    target.kind === "rule" || paid ? null : (
      <CurrencyMenu
        code={code}
        home={home ?? householdCurrency}
        recent={workspace.ledger ? currencyUses(workspace.ledger).map((use) => use.code) : []}
        suggested={{ code: householdCurrency, note: `${view.detail.household.name}'s currency` }}
        lockedTo={householdCurrency}
        locked={isNew && draft.repeat !== "none" ? `Repeating expenses are in ${householdCurrency} only. Set Repeat to Never to use another currency.` : null}
        onPick={(next) => {
          setDraft((previous) => ({
            ...previous,
            currency: next === householdCurrency ? null : next,
            amount: fitAmount(previous.amount, next),
            // A rate belongs to its currency: the new one is looked up.
            rateInput: null,
            repeat: next === householdCurrency ? previous.repeat : "none",
          }));
        }}
      />
    );

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
                    setDraft(draftFrom(next, meId, draft.category, householdCurrency));
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
        // With no rate to convert with, Save waits for one (it still answers a press, pointing at the Rate row).
        <Button type="submit" form={ids.form} variant="primary" busy={save.isPending || conflict !== null} aria-keyshortcuts="Meta+Enter Control+Enter" className={missingRate ? "wbtn--unready" : undefined} {...(missingRate ? { "aria-disabled": true } : {})}>
          {save.isPending ? "Saving…" : isNew ? "Add expense" : "Save"}
          {layout === "desktop" ? <Kbd>{isMac() ? "⌘↵" : "Ctrl ↵"}</Kbd> : null}
        </Button>
      }
      main={
        <>
          <AmountHero
            id={ids.amount}
            inputRef={amountRef}
            value={draft.amount}
            onChange={(value) => { set("amount", value); }}
            currency={code}
            symbol={currencySymbolFor(code, home ?? householdCurrency)}
            placeholder={minorUnits(code) === 0 ? "0" : `0.${"0".repeat(minorUnits(code))}`}
            kind="expense"
            currencyPill={false}
            disabled={paid}
            invalid={describe("amount")}
            error={errorText("amount")}
            {...(currencyControl ? { currencyControl } : {})}
            conversion={foreign ? <ConversionLine amount={draft.amount} code={code} rate={conversionRate} home={householdCurrency} loading={rateMode.mode === "loading"} /> : null}
          />
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
                    <Avatar name={memberName(member)} src={member.avatarUrl} size={26} />
                    <span className="payer-pill__name">{member.userId === meId ? "You" : memberName(member)}</span>
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
            {/* Card `.alloc`: everyone on the expense's date is in the split, so there is nothing to tick (owner decision, MAZ-171). */}
            <ul className="split-rows split-rows--card" aria-label="Shares" aria-describedby={ids.splitWho}>
              {participants.map((member) => {
                const share = preview?.shares?.find((item) => item.userId === member.userId)?.amountCents;
                const name = member.userId === meId ? "You" : memberName(member);
                return (
                  <li key={member.userId} className="split-row">
                    <Avatar name={memberName(member)} src={member.avatarUrl} size={30} />
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
            {foreign ? (
              <RateRow
                id={ids.rate}
                code={code}
                home={householdCurrency}
                state={rateMode}
                input={draft.rateInput}
                onInput={(value) => { set("rateInput", value); }}
                onEdit={() => {
                  if (rateMode.mode === "auto") set("rateInput", displayRate(rateMode.rate.rate));
                  setTimeout(() => {
                    document.getElementById(ids.rate)?.focus();
                  }, 0);
                }}
                invalid={describe("rate")}
                error={errorText("rate")}
              />
            ) : null}
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
          {foreign ? <RateNote state={rateMode} code={code} date={draft.date} today={localDate()} lastRate={null} onUseLast={(value) => { set("rateInput", value); }} /> : null}
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
                  <select id={ids.repeat} value={foreign ? "none" : draft.repeat} disabled={foreign} aria-describedby={foreign ? `${ids.repeat}-locked` : undefined} onChange={(event) => { set("repeat", event.currentTarget.value as Repeat); }}>
                    {isNew ? <option value="none">Doesn't repeat</option> : null}
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
              </div>
            ) : null}
            {foreign ? (
              <p id={`${ids.repeat}-locked`} className="note">
                Repeating expenses are in {householdCurrency} only. Switch the amount to {householdCurrency} to repeat it.
              </p>
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

/** Who the split includes, read with the shares (the card lists everyone included). */
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
