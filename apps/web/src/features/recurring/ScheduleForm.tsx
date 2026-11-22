import { useId, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { saveSchedule } from "@domain/commands.ts";
import { dateKey, parseDate, type Frequency, type Kind, type Ledger, type Recurring } from "@domain/ledger.ts";
import { Button, ChoiceGroup, Kbd } from "../../design/controls";
import { tileStyle } from "../../design/categoryTint";
import { Icon } from "../../design/Icon";
import { AmountHero, DateRowInput, DetailList, DetailRow, EntryDialog, isMac } from "../entries/EntryParts";
import { categoryIcon } from "../entries/model";
import { formatCents } from "../../design/Money";
import { Banner, SaveErrorBanner, useToast } from "../../design/states";
import { TABLET, useMediaQuery } from "../../app/useMediaQuery";
import {
  addSchedule,
  checkDraft,
  datesDueBy,
  dayLabel,
  draftFromRule,
  editedRule,
  emptyDraft,
  MAX_NOTE,
  MAX_TITLE,
  newRule,
  ordinal,
  resumeDate,
  shortDay,
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
  const layout = useMediaQuery(TABLET) ? "desktop" : "phone";
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

  const notices = (
    <>
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
    </>
  );
  const hasNotices = removedElsewhere || changedElsewhere || Boolean(error);
  const category = categories.find((item) => item.id === draft.categoryId);

  // The card `web-schedule-form`, after `web-add-entry`: Type, the amount, Name and Repeats on the left;
  // the dates, category, account, share, note and what saving will do on the right.
  const main = (
    <>
      <ChoiceGroup<Kind>
        legend="Type"
        name={id("kind")}
        value={draft.kind}
        options={kindOptions}
        onChange={(kind) => {
          setDraft((previous) => ({
            ...previous,
            kind,
            categoryId: ledger.categories.some((item) => item.id === previous.categoryId && item.kind === kind)
              ? previous.categoryId
              : (ledger.categories.find((item) => item.kind === kind)?.id ?? ""),
            split: kind === "expense" ? previous.split : "full",
          }));
        }}
      />
      <div className="schedule-form__field">
        <span className="entry-label" aria-hidden="true">
          Amount ({ledger.currency})
        </span>
        <AmountHero id={id("amount")} inputRef={amountRef} value={draft.amount} onChange={(value) => { set("amount", value); }} currency={ledger.currency} currencyPill={false} kind={draft.kind} invalid={describe("amount")} error={errorText("amount")} />
      </div>
      <div className="schedule-form__field entry-title">
        <label htmlFor={id("title")} className="entry-label">
          Name
        </label>
        <input maxLength={MAX_TITLE} autoComplete="off" placeholder={draft.kind === "income" ? "Payday" : draft.kind === "investment" ? "TFSA contribution" : "Internet"} value={draft.title} onChange={(event) => { set("title", event.currentTarget.value); }} {...describe("title")} />
        {errorText("title")}
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
    </>
  );

  const details = (
    <>
      <DetailList>
        <DetailRow icon="calendar" label={original ? "Next date" : "First date"} htmlFor={id("date")} chevron="down">
          <DateRowInput id={id("date")} value={draft.date} onChange={(value) => { set("date", value); }} today={today} long text={fullDay(draft.date)} invalid={describe("date")} />
        </DetailRow>
        <DetailRow icon="pricetag" label="Category" htmlFor={id("categoryId")} chevron="down">
          {category ? (
            <span className="schedule-form__dot" style={tileStyle({ id: category.id, color: category.color, entryKind: draft.kind })} aria-hidden="true">
              <Icon name={categoryIcon(category.icon)} size={11} weight={56} />
            </span>
          ) : null}
          <select className="entry-row__select" value={draft.categoryId} onChange={(event) => { set("categoryId", event.currentTarget.value); }} {...describe("categoryId")}>
            {category ? null : <option value="">Choose a category</option>}
            {categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </DetailRow>
        <DetailRow icon="wallet" label="Account" htmlFor={id("accountId")} chevron="down">
          <select className="entry-row__select" value={draft.accountId} onChange={(event) => { set("accountId", event.currentTarget.value); }} {...describe("accountId")}>
            <option value="">No account</option>
            {draft.accountId && !accounts.some((account) => account.id === draft.accountId) ? <option value={draft.accountId}>Removed account</option> : null}
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </DetailRow>
        {draft.kind === "expense" ? (
          <DetailRow icon="people" label="Your share" htmlFor={id("split")} chevron="down">
            <select id={id("split")} className="entry-row__select" value={draft.split} onChange={(event) => { set("split", event.currentTarget.value as SplitMode); }}>
              <option value="full">All of it</option>
              <option value="equal">Split equally</option>
              <option value="amount">An amount</option>
              <option value="percent">A percentage</option>
            </select>
          </DetailRow>
        ) : null}
        {draft.kind === "expense" && draft.split !== "full" ? (
          <DetailRow icon="options" label={draft.split === "equal" ? "Number of people" : draft.split === "percent" ? "Your percentage" : `Your amount (${ledger.currency})`} htmlFor={id("share")}>
            <input className="entry-row__input" inputMode={draft.split === "equal" ? "numeric" : "decimal"} autoComplete="off" value={draft.shareInput} onChange={(event) => { set("shareInput", event.currentTarget.value); }} {...describe("share")} />
          </DetailRow>
        ) : null}
      </DetailList>
      {errorText("date")}
      {errorText("categoryId")}
      {errorText("accountId")}
      {errorText("share")}
      <section className="entry-section schedule-form__note">
        <label htmlFor={id("note")} className="entry-label">
          Note
        </label>
        <textarea className="entry-note" maxLength={MAX_NOTE} placeholder="Note" rows={1} value={draft.note} onChange={(event) => { set("note", event.currentTarget.value); }} {...describe("note")} />
        {errorText("note")}
      </section>
      <p className="schedule-preview" role="status" aria-live="polite">
        <Icon name="repeat" size={16} />
        <span>{preview}</span>
      </p>
    </>
  );

  const mac = isMac();
  return (
    <EntryDialog
      layout={layout}
      className="schedule-dialog"
      title={title}
      subtitle={original ? "Changes apply to future dates. Entries already recorded keep their details." : "Penny records each entry on its date, in this browser's calendar."}
      onClose={onClose}
      initialFocus={amountRef}
      form={{ id: id("form"), onSubmit, "aria-label": title }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          if (!saving) void submit();
        }
      }}
      {...(hasNotices ? { notices } : {})}
      hint={
        <span className="pk-dialog__hint">
          <Kbd>{mac ? "⌘↵" : "Ctrl ↵"}</Kbd> save · <Kbd>Esc</Kbd> cancel
        </span>
      }
      secondary={
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      }
      primary={
        <Button type="submit" variant="primary" busy={saving || changedElsewhere || removedElsewhere} aria-keyshortcuts="Meta+Enter Control+Enter">
          {saving ? "Saving…" : original ? "Save changes" : "Add schedule"}
        </Button>
      }
      main={main}
      details={details}
    />
  );
}

/** "Nov 18, 2026": the First date row (card `web-schedule-form`). */
function fullDay(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? parseDate(date).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }) : "Choose a date";
}

/**
 * What saving will do with the dates, shown live under the form so the anchor-day and catch-up
 * rules are visible: "First on Nov 18, then monthly on the 18th." (card `web-schedule-form`).
 */
function describePreview(draft: ScheduleDraft, ledger: Ledger, today: string, original: Recurring | undefined): string {
  const { errors } = checkDraft({ ...draft, title: draft.title || "x", amount: draft.amount || "1" }, ledger, today, original);
  if (errors.date) return "Choose a date to see the next dates.";
  const anchorDay = original && draft.date === original.nextDate ? original.anchorDay : parseDate(draft.date).getDate();
  const rule = { frequency: draft.frequency, nextDate: draft.date, anchorDay };
  const short = anchorDay > 28 && draft.frequency !== "weekly" ? ` In months without a ${ordinal(anchorDay)}, it uses the last day.` : "";
  const cadence = cadencePhrase(draft.frequency, draft.date, anchorDay);
  const day = (date: string) => (date.slice(0, 4) === today.slice(0, 4) ? shortDay(date) : `${shortDay(date)}, ${date.slice(0, 4)}`);
  if (original && !original.active) return `Paused. If you resume it today, it continues on ${day(resumeDate(rule, today))}, then ${cadence}.${short}`;
  const due = datesDueBy(draft.date, draft.frequency, anchorDay, today);
  if (due.length) {
    const first = due[0] ?? draft.date;
    const range = due.length === 1 ? day(first) : `${String(due.length)} entries, ${day(first)} through ${day(due[due.length - 1] ?? first)}`;
    return `Saving records ${range} now, then ${cadence}.${short}`;
  }
  return `${original ? "Next" : "First"} on ${day(draft.date)}, then ${cadence}.${short}`;
}

/** "monthly on the 18th", "weekly on Wednesdays", "yearly on Nov 18". */
function cadencePhrase(frequency: Frequency, date: string, anchorDay: number): string {
  if (frequency === "weekly") return `weekly on ${parseDate(date).toLocaleDateString("en-CA", { weekday: "long" })}s`;
  if (frequency === "monthly") return `monthly on the ${ordinal(anchorDay)}`;
  return `yearly on ${shortDay(date)}`;
}
