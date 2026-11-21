import type { Kind, Ledger, Transaction } from "@domain/ledger.ts";
import { useNavigate } from "@tanstack/react-router";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode, type SyntheticEvent } from "react";
import { useAccountEmail } from "../../auth/account";
import { Button, ChoiceGroup, Kbd } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { Dialog } from "../../design/ModalDialog";
import { formatCents } from "../../design/Money";
import { Banner, LoadingState, SaveErrorBanner, useOnline, useToast } from "../../design/states";
import { LedgerSaveError } from "../../offline/engine";
import { ReceiptField } from "../receipts/ReceiptField";
import { draftStore, hasContent } from "./drafts";
import {
  buildEntry,
  draftFromEntry,
  entryChange,
  undoEntryChange,
  FIELD_ORDER,
  frequentCategories,
  futureIncomeNote,
  inlineCategories,
  mostUsedCategories,
  kindLabels,
  FREQUENCY_LABELS,
  newDraft,
  withKind,
  today,
  type DraftErrors,
  type DraftField,
  type EntryDraft,
  type Repeat,
  type ShareMode,
} from "./model";
import { addLabel, AmountHero, CategoryChips, DateRowInput, DetailList, DetailRow, EntryDialog, isMac, KindControl, repeatText, useEntryLayout } from "./EntryParts";
import { CategoryPickerDialog, NewAccountDialog } from "./pickers";
import { HouseholdField, type EntrySeed, type HouseholdScope } from "./scope";
import { useLedgerWriter, type LedgerWriter } from "./writer";

/** `tripId` starts a new expense on that trip (MAZ-93: Trip expense), apart from any kept draft. */
export type EntryTarget = { kind: "new"; entryKind?: Kind; tripId?: string } | { kind: "edit"; entry: Transaction };

const SHARE_LABEL: Record<Exclude<ShareMode, "full">, string> = {
  equal: "People, including you",
  amount: "Your share",
  percent: "Your percentage",
};

/** The Account menu's last option: opens New account instead of choosing. */
const NEW_ACCOUNT = "__new-account";

/**
 * Add or edit a personal entry (specimens `add-expense`, `add-income`, `add-investment`,
 * `entry-extras`, `split`, `edit-entry`, `save-error`, `saved`). Expense, income or investment;
 * frequent categories inline with All categories behind them; labelled date and account; split,
 * repeat, trip, note and receipt under More details. Save sits in the dialog footer, also on ⌘↵ or
 * Ctrl+Enter. The save goes to the durable offline store, so it works offline; any failure keeps
 * the dialog open with the draft and names the next step.
 */
export function EntryFormDialog({
  target,
  onClose,
  onSaved,
  seed,
  scope,
}: {
  target: EntryTarget;
  onClose: () => void;
  onSaved?: (entry: Transaction) => void;
  /** What was typed in the shared form before switching here (Add entry's Household). */
  seed?: EntrySeed;
  /** Add entry's Household choice: a new expense can go to a household instead. */
  scope?: HouseholdScope;
}) {
  const writer = useLedgerWriter();
  const online = useOnline();
  const closeRef = useRef<HTMLButtonElement>(null);
  const title = target.kind === "edit" ? "Edit entry" : "New entry";
  if (!writer.ledger || writer.unavailable) {
    // Offline before this browser ever downloaded the ledger: nothing to add to yet.
    const reason = writer.unavailable ?? (online ? null : "Penny needs to download your ledger once before you can add entries offline. Connect, then try again.");
    return (
      <Dialog
        title={title}
        description={reason ?? undefined}
        onClose={onClose}
        initialFocus={closeRef}
        actions={
          <Button ref={closeRef} variant="secondary" onClick={onClose}>
            Close
          </Button>
        }
      >
        {reason ? null : <LoadingState label="Loading your ledger…" />}
      </Dialog>
    );
  }
  return <EntryForm writer={writer} ledger={writer.ledger} target={target} onClose={onClose} {...(onSaved ? { onSaved } : {})} {...(seed ? { seed } : {})} {...(scope ? { scope } : {})} />;
}

type Conflict = { type: "changed"; latest: Transaction } | { type: "deleted" };

function EntryForm({
  writer,
  ledger,
  target,
  onClose,
  onSaved,
  seed,
  scope,
}: {
  writer: LedgerWriter;
  ledger: Ledger;
  target: EntryTarget;
  onClose: () => void;
  onSaved?: (entry: Transaction) => void;
  seed?: EntrySeed;
  scope?: HouseholdScope;
}) {
  const email = useAccountEmail();
  const toast = useToast();
  const editing = target.kind === "edit" ? target.entry : undefined;
  const tripId = target.kind === "new" ? target.tripId : undefined;
  // A trip expense starts fresh and never replaces the draft kept for Add entry.
  const keepsDraft = target.kind === "new" && !tripId;
  // Coming back from the shared form, what was typed there wins over a kept draft.
  const [restored] = useState(() => (keepsDraft && !seed ? draftStore.get(email) : undefined));
  const [draft, setDraftState] = useState<EntryDraft>(() =>
    editing
      ? draftFromEntry(editing)
      : tripId
        ? { ...newDraft(ledger, "expense"), tripId }
        : seed
          ? seededDraft(ledger, seed, target.kind === "new" ? target.entryKind : undefined)
          : (restored ?? newDraft(ledger, target.kind === "new" ? target.entryKind : undefined)),
  );
  // The version the edit is based on. A stale save is refused against it (the shared `saveEntry` rule).
  const [base, setBase] = useState<Transaction | undefined>(editing);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [more, setMore] = useState(() => Boolean(tripId) || Boolean(editing && (editing.note || editing.tripId || editing.share !== editing.total || editing.receipt)) || Boolean(restored && (restored.note || restored.tripId || restored.split !== "full" || restored.repeat !== "none" || restored.receipt)));
  const [splitOpen, setSplitOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(() => Boolean(draft.receipt));
  const layout = useEntryLayout();
  const navigate = useNavigate();
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [picker, setPicker] = useState<"category" | "account" | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const ids = {
    form: useId(),
    amount: useId(),
    title: useId(),
    date: useId(),
    account: useId(),
    share: useId(),
    repeat: useId(),
    trip: useId(),
    note: useId(),
    more: useId(),
    split: useId(),
    receipt: useId(),
    error: useId(),
    category: useId(),
  };
  const currency = ledger.currency;
  const money = (value: number) => formatCents(value, currency);

  function setDraft(update: (previous: EntryDraft) => EntryDraft) {
    setDraftState((previous) => {
      const next = update(previous);
      if (keepsDraft) {
        if (hasContent(next)) draftStore.set(email, next);
        else draftStore.clear(email);
      }
      return next;
    });
  }
  const set = <K extends keyof EntryDraft>(key: K, value: EntryDraft[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
  };

  const categories = frequentCategories(ledger, draft.kind);
  const inline = inlineCategories(categories, draft.categoryId);
  const preview = buildEntry(draft, ledger, base).built?.transaction;
  const futureNote = futureIncomeNote(draft);
  // Add entry can send a new expense to a household instead (not a personal trip's expense or an edit).
  const householdScope = scope && target.kind === "new" && !tripId && draft.kind === "expense" && scope.households.length ? scope : undefined;

  function focusField(field: DraftField) {
    if (field === "share") setSplitOpen(true);
    if (field === "trip" || field === "note") setMore(true);
    // After Split or More details opens.
    setTimeout(() => {
      const element = document.getElementById(ids[field]);
      if (element instanceof HTMLFieldSetElement) element.querySelector<HTMLInputElement>("input:checked, input")?.focus();
      else element?.focus();
    }, 0);
  }

  async function submit() {
    if (savingRef.current || !writer.save) return;
    if (receiptBusy) {
      setFailure("The receipt is still uploading. Wait for it to finish, or cancel the upload.");
      return;
    }
    const result = buildEntry(draft, ledger, base);
    setErrors(result.errors);
    const first = FIELD_ORDER.find((field) => result.errors[field]);
    if (first || !result.built) {
      if (first) focusField(first);
      return;
    }
    const built = result.built;
    const save = writer.save;
    const original = base;
    const ruleWasNew = Boolean(built.rule && !ledger.recurring.some((item) => item.id === built.rule?.id));
    savingRef.current = true;
    setSaving(true);
    setFailure(null);
    setConflict(null);
    try {
      const receipt = await save(entryChange(built, original));
      if (keepsDraft) draftStore.clear(email);
      const offline = receipt.savedOffline ? "Saved on this device. It syncs when you're back online." : undefined;
      // Card `iphone-saved-toast`: "Expense added · Groceries · $48.90", with Undo.
      const summary = `${built.transaction.title} · ${money(built.transaction.total)}`;
      const detail = offline ?? (target.kind === "new" && built.rule ? `Repeats ${built.rule.frequency}, starting ${built.rule.nextDate}.` : summary);
      toast.show({
        title: target.kind === "new" ? `${kindLabels[built.transaction.kind]} added` : "Changes saved",
        detail,
        onUndo: () => {
          save(undoEntryChange(built, original, ruleWasNew)).catch((error: unknown) => {
            toast.show({
              title: "Couldn't undo",
              detail: error instanceof LedgerSaveError && error.kind === "rule" ? error.message : target.kind === "new" ? "The entry stays added." : "The edit stays saved.",
              tone: "error",
            });
          });
        },
      });
      onSaved?.(built.transaction);
      onClose();
    } catch (error) {
      if (error instanceof LedgerSaveError && error.kind === "rule" && base) {
        // The shared rule refused a stale edit. Show what changed next to the kept draft.
        const latest = writer.ledger?.transactions.find((entry) => entry.id === base.id);
        if (!latest) setConflict({ type: "deleted" });
        else if (JSON.stringify(latest) !== JSON.stringify(base)) setConflict({ type: "changed", latest });
        else setFailure(error.message);
      } else {
        setFailure(error instanceof Error ? error.message : "The entry couldn't be saved.");
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    // ⌘↵ / Ctrl+Enter saves from any field (the nested pickers render elsewhere and handle their own keys).
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && event.currentTarget.contains(event.target as Node)) {
      event.preventDefault();
      void submit();
    }
  }

  function discard() {
    draftStore.clear(email);
    onClose();
  }

  const invalid = (field: DraftField) => (errors[field] ? { "aria-invalid": true as const, "aria-describedby": `${ids.error}-${field}` } : {});
  const errorText = (field: DraftField) =>
    errors[field] ? (
      <span id={`${ids.error}-${field}`} className="form-error">
        {errors[field]}
      </span>
    ) : null;

  const isNew = target.kind === "new";
  const dialogTitle = isNew ? "New entry" : "Edit entry";
  const shareMode = draft.kind === "expense" ? draft.split : "full";
  const expense = draft.kind === "expense";
  const total = preview?.total ?? null;

  const extrasSummary = moreSummary(draft, ledger, isNew);
  const restoredDraft = Boolean(restored && isNew && hasContent(draft));

  const kindControl = (
    <KindControl
      name="entry-kind"
      value={draft.kind}
      onChange={(kind) => {
        setDraft((previous) => withKind(previous, kind, ledger));
      }}
    />
  );

  const accountSelect = (
    <select
      id={ids.account}
      className="entry-row__select"
      value={draft.accountId}
      onChange={(event) => {
        const value = event.currentTarget.value;
        if (value === NEW_ACCOUNT) setPicker("account");
        else set("accountId", value);
      }}
      {...invalid("account")}
    >
      <option value="">None</option>
      {ledger.accounts.map((account) => (
        <option key={account.id} value={account.id}>
          {account.name}
        </option>
      ))}
      {draft.accountId && !ledger.accounts.some((account) => account.id === draft.accountId) ? <option value={draft.accountId}>Removed account</option> : null}
      {writer.save ? <option value={NEW_ACCOUNT}>New account…</option> : null}
    </select>
  );

  const repeatSelect = (
    <select id={ids.repeat} className="entry-row__select" value={draft.repeat} onChange={(event) => { set("repeat", event.currentTarget.value as Repeat); }}>
      {(["none", "weekly", "monthly", "yearly"] as const).map((value) => (
        <option key={value} value={value}>
          {repeatText(value, draft.date)}
        </option>
      ))}
    </select>
  );

  const tripSelect = (
    <select id={ids.trip} className="entry-row__select" value={draft.tripId} onChange={(event) => { set("tripId", event.currentTarget.value); }} {...invalid("trip")}>
      <option value="">None</option>
      {ledger.trips.map((trip) => (
        <option key={trip.id} value={trip.id}>
          {trip.name}
        </option>
      ))}
    </select>
  );

  const noteField = (placeholder: string) => (
    <textarea id={ids.note} className="entry-note" maxLength={1000} placeholder={placeholder} value={draft.note} onChange={(event) => { set("note", event.currentTarget.value); }} {...invalid("note")} />
  );

  const receiptField = (variant: "card" | "drop") => (
    <ReceiptField
      value={draft.receipt}
      variant={variant}
      onChange={(receipt) => {
        set("receipt", receipt);
      }}
      onBusyChange={setReceiptBusy}
    />
  );

  const household = householdScope ? (
    <HouseholdField
      scope={{
        ...householdScope,
        onChoose: (choice, next) => {
          // The shared form takes over what was typed, so the kept draft can't come back as a duplicate.
          draftStore.clear(email);
          householdScope.onChoose(choice, next);
        },
      }}
      seed={() => seedFrom(draft, ledger)}
    />
  ) : null;

  const rows = (
    <DetailList>
      <DetailRow icon="calendar" label="Date" htmlFor={ids.date} {...(layout === "desktop" ? { chevron: "down" as const } : {})}>
        <DateRowInput id={ids.date} value={draft.date} onChange={(value) => { set("date", value); }} today={today()} long={layout === "desktop"} invalid={invalid("date")} />
      </DetailRow>
      <DetailRow icon={draft.kind === "income" ? "wallet" : "card"} label="Account" htmlFor={ids.account} {...(layout === "desktop" ? { chevron: "down" as const } : {})}>
        {accountSelect}
      </DetailRow>
      {expense ? (
        <button type="button" className="entry-row entry-row--button" aria-expanded={splitOpen} aria-controls={ids.split} onClick={() => { setSplitOpen((open) => !open); }}>
          <Icon name="people" size={18} />
          <span className="entry-row__label">Split</span>
          <span className="entry-row__value">
            <span>{splitValue(draft, preview?.share, money, layout === "desktop" ? "people" : "ways")}</span>
          </span>
        </button>
      ) : null}
      {layout === "phone" ? (
        expense ? (
          <button type="button" className="entry-row entry-row--button" aria-expanded={more} aria-controls={ids.more} onClick={() => { setMore((open) => !open); }}>
            <Icon name="ellipsis-horizontal" size={18} />
            <span className="entry-row__label">Receipt, repeat, trip</span>
            <span className="entry-row__value">
              {extrasSummary}
              <Icon name={more ? "chevron-down" : "chevron-forward"} size={13} weight={48} />
            </span>
          </button>
        ) : (
          <>
            {isNew ? (
              <DetailRow icon="repeat" label="Repeat" htmlFor={ids.repeat} chevron="forward">
                {repeatSelect}
              </DetailRow>
            ) : null}
            <DetailRow icon="document-text" label="Note" htmlFor={ids.note}>
              <input id={ids.note} className="entry-row__input" maxLength={1000} autoComplete="off" placeholder="Optional" value={draft.note} onChange={(event) => { set("note", event.currentTarget.value); }} {...invalid("note")} />
            </DetailRow>
          </>
        )
      ) : (
        <>
          {isNew ? (
            <DetailRow icon="repeat" label="Repeat" htmlFor={ids.repeat} {...(layout === "tablet" ? { chevron: "forward" as const } : {})}>
              {repeatSelect}
            </DetailRow>
          ) : null}
          {expense ? (
            <DetailRow icon="airplane" label="Trip" htmlFor={ids.trip} {...(layout === "tablet" ? { chevron: "forward" as const } : {})}>
              {tripSelect}
            </DetailRow>
          ) : null}
          {expense && layout === "tablet" ? (
            <button type="button" className="entry-row entry-row--button" aria-expanded={receiptOpen} aria-controls={ids.receipt} onClick={() => { setReceiptOpen((open) => !open); }}>
              <Icon name="receipt" size={18} />
              <span className="entry-row__label">Receipt</span>
              <span className="entry-row__value">
                {draft.receipt ? draft.receipt.name || "Attached" : "Add"}
                <Icon name={receiptOpen ? "chevron-down" : "chevron-forward"} size={13} weight={48} />
              </span>
            </button>
          ) : null}
        </>
      )}
    </DetailList>
  );

  const split = expense ? (
    <div id={ids.split} className="entry-split" hidden={!splitOpen}>
      <ChoiceGroup<ShareMode>
        legend="Split"
        hideLegend
        name="entry-split"
        value={draft.split}
        onChange={(mode) => {
          setDraft((previous) => ({ ...previous, split: mode, shareInput: mode === "equal" ? (previous.split === "equal" ? previous.shareInput : "2") : mode === "percent" ? "50" : mode === "full" ? "" : previous.shareInput }));
        }}
        options={[
          { value: "full", label: "All mine" },
          { value: "equal", label: "Equally" },
          { value: "amount", label: "Amount" },
          { value: "percent", label: "Percent" },
        ]}
      />
      {shareMode === "equal" ? (
        <div className="entry-split__field">
          <label htmlFor={ids.share}>People, including you</label>
          <span className="entry-stepper">
            <button type="button" aria-label="Fewer people" disabled={peopleCount(draft.shareInput) <= 2} onClick={() => { set("shareInput", String(Math.max(2, peopleCount(draft.shareInput) - 1))); }}>
              −
            </button>
            <input id={ids.share} inputMode="numeric" autoComplete="off" value={draft.shareInput} onChange={(event) => { set("shareInput", event.currentTarget.value); }} {...invalid("share")} />
            <button type="button" aria-label="More people" disabled={peopleCount(draft.shareInput) >= 100} onClick={() => { set("shareInput", String(Math.min(100, peopleCount(draft.shareInput) + 1))); }}>
              +
            </button>
          </span>
        </div>
      ) : shareMode !== "full" ? (
        <div className="entry-split__field">
          <label htmlFor={ids.share}>{SHARE_LABEL[shareMode]}</label>
          <span className="entry-split__input">
            <input id={ids.share} inputMode="decimal" autoComplete="off" placeholder={shareMode === "amount" ? "0.00" : "50"} value={draft.shareInput} onChange={(event) => { set("shareInput", event.currentTarget.value); }} {...invalid("share")} />
            {shareMode === "percent" ? <span aria-hidden="true">%</span> : null}
          </span>
        </div>
      ) : null}
      {errorText("share")}
      <div className="entry-share" role="status">
        <span className="entry-label">Your share</span>
        {total === null || !preview ? (
          <span className="note">Enter the amount first.</span>
        ) : (
          <>
            <span className="entry-share__amount pk-num">{money(preview.share)}</span>
            <span className="note">Only your share counts toward your spending. The {money(total)} total stays on the entry.</span>
          </>
        )}
      </div>
    </div>
  ) : null;

  const extras =
    layout === "phone" && expense ? (
      <div id={ids.more} className="entry-extras" hidden={!more}>
        <section className="entry-section">{receiptField("card")}</section>
        {isNew ? (
          <section className="entry-section">
            <ChoiceGroup<Repeat>
              legend="Repeat"
              name="entry-repeat"
              value={draft.repeat}
              describedBy={ids.repeat}
              onChange={(value) => {
                set("repeat", value);
              }}
              options={[
                { value: "none", label: "Never" },
                { value: "weekly", label: "Weekly" },
                { value: "monthly", label: "Monthly" },
                { value: "yearly", label: "Yearly" },
              ]}
            />
            <p id={ids.repeat} className="note">
              Repeating creates a schedule you can pause in Recurring.
            </p>
          </section>
        ) : null}
        <fieldset className="choices entry-section entry-trips" id={ids.trip} {...(errors.trip ? { "aria-describedby": `${ids.error}-trip` } : {})}>
          <legend className="entry-label">Trip</legend>
          <div className="entry-trips__list">
            {[{ id: "", name: "No trip" }, ...ledger.trips].map((trip) => (
              <label key={trip.id || "none"} className="entry-trip">
                <input type="radio" name="entry-trip" value={trip.id} checked={draft.tripId === trip.id} onChange={() => { set("tripId", trip.id); }} />
                <Icon name={trip.id ? "airplane" : "close"} size={18} />
                <span>{trip.name}</span>
                {draft.tripId === trip.id ? <Icon name="checkmark" size={18} weight={48} /> : null}
              </label>
            ))}
          </div>
          {errorText("trip")}
        </fieldset>
        <section className="entry-section">
          <label htmlFor={ids.note} className="entry-label">
            Note
          </label>
          {noteField("Anything you'd like to remember")}
          {errorText("note")}
        </section>
        {household ? <section className="entry-section">{household}</section> : null}
      </div>
    ) : null;

  const notes = (
    <>
      {futureNote ? (
        <p className="callout callout--pending" role="status">
          <Icon name="time" size={18} />
          <span>
            {/* The card sets "expected" in bold. */}
            {futureNote.split(/(expected)/).map((part, index) => (part === "expected" ? <b key={index}>{part}</b> : part))}
          </span>
        </p>
      ) : null}
      {draft.repeat !== "none" && isNew ? <p className="note">This entry is the first one. Penny adds the next on its date, {draft.repeat}.</p> : null}
      {editing?.recurringId ? <p className="note">This entry came from a repeating schedule. Editing it changes only this one.</p> : null}
    </>
  );

  const fieldErrors = (
    <>
      {errorText("date")}
      {errorText("account")}
      {layout === "phone" ? null : errorText("trip")}
    </>
  );

  const details =
    layout === "phone" ? (
      <>
        {rows}
        {fieldErrors}
        {split}
        {extras}
        {notes}
      </>
    ) : (
      <>
        {layout === "tablet" ? <span className="entry-label">Details</span> : null}
        {rows}
        {fieldErrors}
        {split}
        {expense && layout === "tablet" ? (
          <div id={ids.receipt} className="entry-section" hidden={!receiptOpen}>
            {receiptField("card")}
          </div>
        ) : null}
        {expense && layout === "desktop" ? receiptField("drop") : null}
        {notes}
        <section className="entry-section">
          <label htmlFor={ids.note} className="entry-label">
            Note
          </label>
          {noteField("Anything you'd like to remember")}
          {errorText("note")}
        </section>
        {household ? <section className="entry-section">{household}</section> : null}
      </>
    );

  const main = (
    <>
      <AmountHero id={ids.amount} inputRef={amountRef} value={draft.amount} onChange={(value) => { set("amount", value); }} currency={currency} kind={draft.kind} invalid={invalid("amount")} error={errorText("amount")} />
      <div className="entry-title">
        <label htmlFor={ids.title} className="visually-hidden">
          Title
        </label>
        <input id={ids.title} maxLength={100} autoComplete="off" placeholder="Title" value={draft.title} onChange={(event) => { set("title", event.currentTarget.value); }} {...invalid("title")} />
        {errorText("title")}
      </div>
      <CategoryChips
        id={ids.category}
        name="entry-category"
        categories={inline.map((category) => ({ key: category.id, name: category.name, tint: { id: category.id, color: category.color, entryKind: draft.kind }, icon: category.icon }))}
        selected={draft.categoryId}
        onChoose={(id) => {
          set("categoryId", id);
        }}
        onAll={() => {
          setPicker("category");
        }}
        {...(errors.category ? { describedBy: `${ids.error}-category` } : {})}
        empty={categories.length === 0 ? <p className="note">You have no {kindLabels[draft.kind].toLowerCase()} categories yet. Add one from All categories.</p> : null}
        error={errorText("category")}
      />
    </>
  );

  const notices = (
    <>
      {restoredDraft ? (
        <p className="note" role="status">
          Your unsaved draft is back. Save it, or discard it to start over.
        </p>
      ) : null}
      {conflict?.type === "changed" ? (
        <Banner
          tone="error"
          title="This entry changed on another device"
          action={
            <span className="shared-actions">
              <Button
                onClick={() => {
                  setBase(conflict.latest);
                  setConflict(null);
                }}
              >
                Keep my changes
              </Button>
              <Button
                variant="quiet"
                onClick={() => {
                  setDraft(() => draftFromEntry(conflict.latest));
                  setBase(conflict.latest);
                  setConflict(null);
                }}
              >
                Use their version
              </Button>
            </span>
          }
        >
          Nothing was saved and your changes are still here. Their version: {conflict.latest.title}, {money(conflict.latest.total)} on {conflict.latest.date}. Keep my changes saves yours over it when you press Save.
        </Banner>
      ) : null}
      {conflict?.type === "deleted" ? (
        <Banner
          tone="error"
          title="This entry was deleted on another device"
          action={
            <Button
              onClick={() => {
                setBase(undefined);
                setConflict(null);
              }}
            >
              Keep as a new entry
            </Button>
          }
        >
          Nothing was saved and your changes are still here. Keep as a new entry adds it back when you press Save, or close to let it go.
        </Banner>
      ) : null}
      {failure ? <SaveErrorBanner message={failure} onRetry={() => void submit()} retrying={saving} /> : null}
    </>
  );
  const hasNotices = restoredDraft || conflict !== null || failure !== null;

  const primary = (
    <Button type="submit" form={ids.form} variant="primary" busy={saving} aria-keyshortcuts="Meta+Enter Control+Enter">
      {saving ? "Saving…" : isNew ? addLabel(draft.kind) : "Save"}
      {layout === "desktop" ? <Kbd>{isMac() ? "⌘↵" : "Ctrl ↵"}</Kbd> : null}
    </Button>
  );

  return (
    <EntryDialog
      layout={layout}
      title={dialogTitle}
      kindControl={kindControl}
      onClose={onClose}
      initialFocus={amountRef}
      form={{ id: ids.form, onSubmit, "aria-label": dialogTitle }}
      onKeyDown={onKeyDown}
      {...(hasNotices ? { notices } : {})}
      secondary={
        <>
          {restoredDraft ? (
            <Button variant="danger-quiet" onClick={discard}>
              Discard draft
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
      primary={primary}
      main={main}
      details={details}
    >
      {picker === "category" ? (
        <CategoryPickerDialog
          kind={draft.kind}
          categories={categories}
          mostUsed={mostUsedCategories(ledger, draft.kind)}
          selected={draft.categoryId}
          save={writer.save}
          onSelect={(id) => {
            if (id) set("categoryId", id);
          }}
          onClose={() => {
            setPicker(null);
          }}
          onEditCategories={() => {
            // The draft is kept, so it comes back when Add entry opens again.
            setPicker(null);
            onClose();
            void navigate({ to: "/categories" });
          }}
        />
      ) : null}
      {picker === "account" && writer.save ? (
        <NewAccountDialog
          save={writer.save}
          onCreated={(id) => {
            set("accountId", id);
          }}
          onClose={() => {
            setPicker(null);
          }}
        />
      ) : null}
    </EntryDialog>
  );
}

/** What a personal draft carries to the shared form. */
function seedFrom(draft: EntryDraft, ledger: Ledger): EntrySeed {
  const category = ledger.categories.find((item) => item.id === draft.categoryId);
  return {
    amount: draft.amount,
    title: draft.title,
    date: draft.date,
    ...(category ? { categoryName: category.name } : {}),
    accountId: draft.accountId,
    note: draft.note,
    receipt: draft.receipt,
  };
}

/** A new draft holding what was typed in the shared form; the category is matched by name. */
function seededDraft(ledger: Ledger, seed: EntrySeed, kind: Kind = "expense"): EntryDraft {
  const fresh = newDraft(ledger, kind, seed.date);
  const category = ledger.categories.find((item) => item.kind === kind && item.name === seed.categoryName);
  return {
    ...fresh,
    amount: seed.amount,
    title: seed.title,
    note: seed.note,
    accountId: ledger.accounts.some((item) => item.id === seed.accountId) ? seed.accountId : "",
    receipt: kind === "expense" ? seed.receipt : null,
    ...(category ? { categoryId: category.id } : {}),
  };
}

/** What the phone's "Receipt, repeat, trip" row holds, as on iOS: "Receipt · Monthly · Lisbon trip · Note". */
function moreSummary(draft: EntryDraft, ledger: Ledger, isNew: boolean): string {
  const parts: string[] = [];
  if (draft.kind === "expense" && draft.receipt) parts.push("Receipt");
  if (isNew && draft.repeat !== "none") parts.push(FREQUENCY_LABELS[draft.repeat]);
  const trip = draft.kind === "expense" && draft.tripId ? ledger.trips.find((item) => item.id === draft.tripId) : undefined;
  if (trip) parts.push(trip.name);
  if (draft.note.trim()) parts.push("Note");
  return parts.join(" · ");
}

/** The Split row: "All mine", "3 ways · $24.80 yours" (the web card: "3 people"), "$30.00 yours". */
function splitValue(draft: EntryDraft, share: number | undefined, money: (cents: number) => string, unit: "ways" | "people"): ReactNode {
  if (draft.split === "full") return "All mine";
  if (share === undefined) return "Check the split";
  const yours = (
    <>
      <b className="entry-row__share pk-num">{money(share)}</b> yours
    </>
  );
  return draft.split === "equal" ? (
    <>
      {draft.shareInput} {unit} · {yours}
    </>
  ) : (
    yours
  );
}

const peopleCount = (input: string) => {
  const value = Number.parseInt(input, 10);
  return Number.isFinite(value) ? value : 2;
};
