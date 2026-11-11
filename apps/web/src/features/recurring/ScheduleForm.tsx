import { useId, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { saveSchedule } from "@domain/commands.ts";
import { dateKey, parseDate, type Frequency, type Kind, type Ledger, type Recurring } from "@domain/ledger.ts";
import { Button, ChoiceGroup } from "../../design/controls";
import { Dialog } from "../../design/ModalDialog";
import { formatCents } from "../../design/Money";
import { Banner, SaveErrorBanner, useToast } from "../../design/states";
import {
  addSchedule,
  checkDraft,
  datesDueBy,
  dayLabel,
  draftFromRule,
  editedRule,
  emptyDraft,
  LAST_DATE,
  MAX_NOTE,
  MAX_TITLE,
  newRule,
  ordinal,
  resumeDate,
  shortDay,
  upcomingDates,
  type DraftErrors,
  type DraftField,
  type ScheduleDraft,
  type SplitMode,
} from "./model";
import { savedDetail, useScheduleSave } from "./save";

const FIELD_ORDER: DraftField[] = ["amount", "title", "date", "categoryId", "accountId", "share", "note"];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

interface Props {
  ledger: Ledger;
  /** The rule being edited; absent for a new schedule. */
  original?: Recurring;
  onClose: () => void;
  /** After a successful save (defaults to `onClose`). */
  onSaved?: () => void;
}

/**
 * New and edit schedule (specimens `schedule`, `edit-schedule`): weekly, monthly or yearly income,
 * expense or investment with a category and an optional account. The next dates and any catch-up
 * are shown before saving. A refused save keeps the form open with the draft; an offline save is
 * kept on this device and syncs later. If the schedule changes in another tab or on another device
 * while it is open, the person chooses between their draft and the latest version.
 */
export function ScheduleFormDialog({ ledger, original: opened, onClose, onSaved = onClose }: Props) {
  const toast = useToast();
  const today = dateKey();
  const [original, setOriginal] = useState(opened);
  const [draft, setDraft] = useState<ScheduleDraft>(() => (opened ? draftFromRule(opened) : emptyDraft(ledger, today)));
  const [errors, setErrors] = useState<DraftErrors>({});
  const { save, saving, error, clearError } = useScheduleSave();
  const amountRef = useRef<HTMLInputElement>(null);
  const base = useId();
  const id = (field: string) => `${base}-${field}`;

  const live = original ? ledger.recurring.find((rule) => rule.id === original.id) : undefined;
  const removedElsewhere = original !== undefined && live === undefined;
  const changedElsewhere = original !== undefined && live !== undefined && !same(live, original);

  const set = <K extends keyof ScheduleDraft>(key: K, value: ScheduleDraft[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
  };
  const categories = ledger.categories.filter((category) => category.kind === draft.kind);
  const accounts = ledger.accounts;

  const preview = useMemo(() => describePreview(draft, ledger, today, original), [draft, ledger, today, original]);

  async function submit() {
    const result = checkDraft(draft, ledger, today, original);
    setErrors(result.errors);
    const first = FIELD_ORDER.find((field) => result.errors[field]);
    if (first || !result.built) {
      if (first) document.getElementById(id(first))?.focus();
      return;
    }
    const receipt = original
      ? await save(saveSchedule(editedRule(original, draft, result.built), original))
      : await save(addSchedule(newRule(draft, result.built)));
    if (!receipt) return;
    const title = result.built.title;
    toast.show(
      original
        ? { title: "Schedule updated", detail: savedDetail(receipt, "Future dates use the changes. Recorded entries keep their details.") }
        : { title: `${title} added`, detail: savedDetail(receipt, draft.date <= today ? "Penny recorded the dates up to today." : `First on ${dayLabel(draft.date)}.`) },
    );
    onSaved();
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!saving) void submit();
  }

  const describe = (field: DraftField, hint?: string) => {
    const described = [errors[field] ? `${id(field)}-error` : null, hint ?? null].filter(Boolean).join(" ");
    return { id: id(field), ...(errors[field] ? { "aria-invalid": true as const } : {}), ...(described ? { "aria-describedby": described } : {}) };
  };
  const errorText = (field: DraftField) =>
    errors[field] ? (
      <span id={`${id(field)}-error`} className="form-error">
        {errors[field]}
      </span>
    ) : null;

  const title = original ? "Edit schedule" : "New schedule";
  const kindOptions: { value: Kind; label: string }[] = [
    { value: "expense", label: "Expense" },
    { value: "income", label: "Income" },
    { value: "investment", label: "Investment" },
  ];

  return (
    <Dialog
      title={title}
      description={original ? "Changes apply to future dates. Entries already recorded keep their details." : "Penny records each entry on its date, in this browser's calendar."}
      onClose={onClose}
      initialFocus={amountRef}
      wide
    >
      <form className="form" onSubmit={onSubmit} noValidate aria-label={title}>
        {removedElsewhere ? (
          <Banner tone="error" title="This schedule was removed on another device">
            Nothing was saved. Close this form; entries it already recorded stay in your activity.
          </Banner>
        ) : null}
        {changedElsewhere ? (
          <Banner
            tone="error"
            title="This schedule changed on another device"
            action={
              <span className="shared-actions">
                <Button
                  onClick={() => {
                    setOriginal(live);
                    clearError();
                  }}
                >
                  Keep my changes
                </Button>
                <Button
                  variant="quiet"
                  onClick={() => {
                    setOriginal(live);
                    setDraft(draftFromRule(live));
                    setErrors({});
                    clearError();
                  }}
                >
                  Use the latest
                </Button>
              </span>
            }
          >
            Nothing was saved and your changes are still here. Latest: {live.title}, {formatCents(live.share, ledger.currency)}, {live.active ? `next ${shortDay(live.nextDate)}` : "paused"}.
          </Banner>
        ) : null}
        {error && !changedElsewhere && !removedElsewhere ? (
          <SaveErrorBanner
            message={error}
            onRetry={() => {
              void submit();
            }}
            retrying={saving}
          />
        ) : null}

        <ChoiceGroup<Kind>
          legend="Type"
          name={id("kind")}
          value={draft.kind}
          options={kindOptions}
          onChange={(kind) => {
            setDraft((previous) => ({
              ...previous,
              kind,
              categoryId: ledger.categories.some((category) => category.id === previous.categoryId && category.kind === kind)
                ? previous.categoryId
                : (ledger.categories.find((category) => category.kind === kind)?.id ?? ""),
              split: kind === "expense" ? previous.split : "full",
            }));
          }}
        />

        <div className="form-grid">
          <div className="form-field form-amount">
            <label htmlFor={id("amount")}>Amount ({ledger.currency})</label>
            <input ref={amountRef} inputMode="decimal" autoComplete="off" placeholder="0.00" value={draft.amount} onChange={(event) => { set("amount", event.currentTarget.value); }} {...describe("amount")} />
            {errorText("amount")}
          </div>
          <div className="form-field">
            <label htmlFor={id("title")}>Name</label>
            <input maxLength={MAX_TITLE} autoComplete="off" placeholder={draft.kind === "income" ? "Payday" : draft.kind === "investment" ? "TFSA contribution" : "Internet"} value={draft.title} onChange={(event) => { set("title", event.currentTarget.value); }} {...describe("title")} />
            {errorText("title")}
          </div>
        </div>

        <ChoiceGroup<Frequency>
          legend="Repeats"
          name={id("frequency")}
          value={draft.frequency}
          options={[
            { value: "weekly", label: "Weekly" },
            { value: "monthly", label: "Monthly" },
            { value: "yearly", label: "Yearly" },
          ]}
          onChange={(frequency) => {
            set("frequency", frequency);
          }}
        />

        <div className="form-grid">
          <div className="form-field">
            <label htmlFor={id("date")}>{original ? "Next date" : "First date"}</label>
            <input type="date" min={original ? today : "2000-01-01"} max={LAST_DATE} value={draft.date} onChange={(event) => { set("date", event.currentTarget.value); }} {...describe("date")} />
            {errorText("date")}
          </div>
          <div className="form-field">
            <label htmlFor={id("categoryId")}>Category</label>
            <select value={draft.categoryId} onChange={(event) => { set("categoryId", event.currentTarget.value); }} {...describe("categoryId")}>
              {categories.some((category) => category.id === draft.categoryId) ? null : <option value="">Choose a category</option>}
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            {errorText("categoryId")}
          </div>
          <div className="form-field">
            <label htmlFor={id("accountId")}>Account</label>
            <select value={draft.accountId} onChange={(event) => { set("accountId", event.currentTarget.value); }} {...describe("accountId")}>
              <option value="">No account</option>
              {draft.accountId && !accounts.some((account) => account.id === draft.accountId) ? <option value={draft.accountId}>Removed account</option> : null}
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
            {errorText("accountId")}
          </div>
        </div>

        {draft.kind === "expense" ? (
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor={id("split")}>Your share</label>
              <select id={id("split")} value={draft.split} onChange={(event) => { set("split", event.currentTarget.value as SplitMode); }}>
                <option value="full">All of it</option>
                <option value="equal">Split equally</option>
                <option value="amount">An amount</option>
                <option value="percent">A percentage</option>
              </select>
            </div>
            {draft.split !== "full" ? (
              <div className="form-field">
                <label htmlFor={id("share")}>{draft.split === "equal" ? "Number of people" : draft.split === "percent" ? "Your percentage" : `Your amount (${ledger.currency})`}</label>
                <input inputMode={draft.split === "equal" ? "numeric" : "decimal"} autoComplete="off" value={draft.shareInput} onChange={(event) => { set("shareInput", event.currentTarget.value); }} {...describe("share")} />
                {errorText("share")}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="form-field">
          <label htmlFor={id("note")}>Note</label>
          <textarea maxLength={MAX_NOTE} value={draft.note} onChange={(event) => { set("note", event.currentTarget.value); }} {...describe("note")} />
          {errorText("note")}
        </div>

        <p className="schedule-preview" role="status" aria-live="polite">
          {preview}
        </p>

        <div className="form-actions">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={saving || changedElsewhere || removedElsewhere}>
            {saving ? "Saving…" : original ? "Save changes" : "Add schedule"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** What saving will do with the dates: shown live under the form so the anchor-day and catch-up rules are visible. */
function describePreview(draft: ScheduleDraft, ledger: Ledger, today: string, original: Recurring | undefined): string {
  const { errors } = checkDraft({ ...draft, title: draft.title || "x", amount: draft.amount || "1" }, ledger, today, original);
  if (errors.date) return "Choose a date to see the next dates.";
  const anchorDay = original && draft.date === original.nextDate ? original.anchorDay : parseDate(draft.date).getDate();
  const rule = { frequency: draft.frequency, nextDate: draft.date, anchorDay };
  const short = anchorDay > 28 && draft.frequency !== "weekly" ? ` In months without a ${ordinal(anchorDay)}, it uses the last day.` : "";
  if (original && !original.active) return `Paused. If you resume it today, it continues on ${dayLabel(resumeDate(rule, today), true)}.${short}`;
  const due = datesDueBy(draft.date, draft.frequency, anchorDay, today);
  if (due.length) {
    const after = upcomingDates({ ...rule, nextDate: nextAfter(due, rule) }, 1)[0];
    const first = due[0] ?? draft.date;
    const range = due.length === 1 ? dayLabel(first, true) : `${String(due.length)} entries, ${dayLabel(first, true)} through ${dayLabel(due[due.length - 1] ?? first, true)}`;
    return `Saving records ${range} now.${after ? ` Then next on ${dayLabel(after, true)}.` : ""}${short}`;
  }
  const dates = upcomingDates(rule, 3);
  return `${original ? "Next" : "First"} on ${dates.map((date, index) => dayLabel(date, date.slice(0, 4) !== (dates[index - 1] ?? "").slice(0, 4))).join(", then ")}.${short}`;
}

function nextAfter(due: string[], rule: { frequency: Frequency; nextDate: string; anchorDay: number }): string {
  const last = due[due.length - 1] ?? rule.nextDate;
  return upcomingDates({ ...rule, nextDate: last }, 2)[1] ?? "2101-01-01";
}
