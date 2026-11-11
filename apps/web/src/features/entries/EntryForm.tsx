import { kinds, type Kind, type Ledger, type Transaction } from "@domain/ledger.ts";
import { useId, useRef, useState, type KeyboardEvent, type SyntheticEvent } from "react";
import { useAccountEmail } from "../../auth/account";
import { Button, ChoiceGroup, cx, Kbd } from "../../design/controls";
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
  FIELD_ORDER,
  frequentCategories,
  inlineCategories,
  kindLabels,
  newDraft,
  withKind,
  categoryIcon,
  type DraftErrors,
  type DraftField,
  type EntryDraft,
  type Repeat,
  type ShareMode,
} from "./model";
import { CategoryPickerDialog, NewAccountDialog } from "./pickers";
import { useLedgerWriter, type LedgerWriter } from "./writer";

export type EntryTarget = { kind: "new"; entryKind?: Kind } | { kind: "edit"; entry: Transaction };

const KIND_HINT: Record<Kind, string> = {
  expense: "Money you spent. Split it to count only your share.",
  income: "Money you received.",
  investment: "Money you set aside. It isn't spending, but it comes out of what's left this month.",
};

const SHARE_LABEL: Record<Exclude<ShareMode, "full">, string> = {
  equal: "Number of people",
  amount: "Your amount",
  percent: "Your percentage",
};

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Add or edit a personal entry (specimens `add-expense`, `add-income`, `add-investment`,
 * `entry-extras`, `split`, `edit-entry`, `save-error`, `saved`). Expense, income or investment;
 * frequent categories inline with All categories behind them; labelled date and account; split,
 * repeat, trip, note and receipt under More details. Save sits in the dialog footer, also on ⌘↵ or
 * Ctrl+Enter. The save goes to the durable offline store, so it works offline; any failure keeps
 * the dialog open with the draft and names the next step.
 */
export function EntryFormDialog({ target, onClose, onSaved }: { target: EntryTarget; onClose: () => void; onSaved?: (entry: Transaction) => void }) {
  const writer = useLedgerWriter();
  const online = useOnline();
  const closeRef = useRef<HTMLButtonElement>(null);
  const title = target.kind === "edit" ? "Edit entry" : "Add entry";
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
  return <EntryForm writer={writer} ledger={writer.ledger} target={target} onClose={onClose} {...(onSaved ? { onSaved } : {})} />;
}

type Conflict = { type: "changed"; latest: Transaction } | { type: "deleted" };

function EntryForm({ writer, ledger, target, onClose, onSaved }: { writer: LedgerWriter; ledger: Ledger; target: EntryTarget; onClose: () => void; onSaved?: (entry: Transaction) => void }) {
  const email = useAccountEmail();
  const toast = useToast();
  const editing = target.kind === "edit" ? target.entry : undefined;
  const [restored] = useState(() => (target.kind === "new" ? draftStore.get(email) : undefined));
  const [draft, setDraftState] = useState<EntryDraft>(() => editing ? draftFromEntry(editing) : (restored ?? newDraft(ledger, target.kind === "new" ? target.entryKind : undefined)));
  // The version the edit is based on. A stale save is refused against it (the shared `saveEntry` rule).
  const [base, setBase] = useState<Transaction | undefined>(editing);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [more, setMore] = useState(() => Boolean(editing && (editing.note || editing.tripId || editing.share !== editing.total || editing.receipt)) || Boolean(restored && (restored.note || restored.tripId || restored.split !== "full" || restored.repeat !== "none" || restored.receipt)));
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
    error: useId(),
    kindHint: useId(),
    category: useId(),
  };
  const currency = ledger.currency;
  const money = (value: number) => formatCents(value, currency);

  function setDraft(update: (previous: EntryDraft) => EntryDraft) {
    setDraftState((previous) => {
      const next = update(previous);
      if (target.kind === "new") {
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
  const showTrips = draft.kind === "expense";
  const preview = buildEntry(draft, ledger, base).built?.transaction;

  function focusField(field: DraftField) {
    if (field === "share" || field === "trip" || field === "note") setMore(true);
    // After More details opens.
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
    savingRef.current = true;
    setSaving(true);
    setFailure(null);
    setConflict(null);
    try {
      const receipt = await writer.save(entryChange(built, base));
      if (target.kind === "new") draftStore.clear(email);
      const offline = receipt.savedOffline ? "Saved on this device. It syncs when you're back online." : undefined;
      toast.show(
        target.kind === "new"
          ? { title: `${kindLabels[built.transaction.kind]} added`, ...(offline ? { detail: offline } : built.rule ? { detail: `Repeats ${built.rule.frequency}, starting ${built.rule.nextDate}.` } : {}) }
          : { title: "Changes saved", ...(offline ? { detail: offline } : {}) },
      );
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

  const dialogTitle = target.kind === "edit" ? "Edit entry" : "Add entry";
  const shareMode = draft.kind === "expense" ? draft.split : "full";

  return (
    <Dialog
      title={dialogTitle}
      onClose={onClose}
      initialFocus={amountRef}
      wide
      hint={
        <>
          <Kbd>{isMac() ? "⌘" : "Ctrl"}</Kbd>
          <Kbd>↵</Kbd> to save · <Kbd>Esc</Kbd> to close
        </>
      }
      actions={
        <>
          {target.kind === "new" && hasContent(draft) ? (
            <Button variant="danger-quiet" onClick={discard}>
              Discard draft
            </Button>
          ) : null}
          <Button variant="quiet" onClick={onClose}>
            {target.kind === "new" && hasContent(draft) ? "Keep draft" : "Cancel"}
          </Button>
          <Button type="submit" form={ids.form} variant="primary" busy={saving} aria-keyshortcuts="Meta+Enter Control+Enter">
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form id={ids.form} className="form entry-form" onSubmit={onSubmit} onKeyDown={onKeyDown} noValidate aria-label={dialogTitle}>
        {restored && target.kind === "new" ? (
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

        <ChoiceGroup<Kind>
          legend="Type"
          name="entry-kind"
          value={draft.kind}
          describedBy={ids.kindHint}
          onChange={(kind) => {
            setDraft((previous) => withKind(previous, kind, ledger));
          }}
          options={kinds.map((kind) => ({ value: kind, label: kindLabels[kind] }))}
        />
        <p id={ids.kindHint} className="note">
          {KIND_HINT[draft.kind]}
        </p>

        <div className="form-grid">
          <div className="form-field form-amount">
            <label htmlFor={ids.amount}>Amount ({currency})</label>
            <input id={ids.amount} ref={amountRef} inputMode="decimal" autoComplete="off" placeholder="0.00" value={draft.amount} onChange={(event) => { set("amount", event.currentTarget.value); }} {...invalid("amount")} />
            {errorText("amount")}
          </div>
          <div className="form-field">
            <label htmlFor={ids.title}>Title</label>
            <input id={ids.title} maxLength={100} autoComplete="off" value={draft.title} onChange={(event) => { set("title", event.currentTarget.value); }} {...invalid("title")} />
            {errorText("title")}
          </div>
        </div>

        <fieldset className="choices category-chips" id={ids.category} {...(errors.category ? { "aria-describedby": `${ids.error}-category` } : {})}>
          <legend className="choices__legend">Category</legend>
          <div className="chip-row">
            {inline.map((category) => (
              <label key={category.id} className={cx("chip", category.id === draft.categoryId && "chip--on")}>
                <input type="radio" name="entry-category" value={category.id} checked={category.id === draft.categoryId} onChange={() => { set("categoryId", category.id); }} />
                <span className="category-dot" style={{ color: category.color }}>
                  <Icon name={categoryIcon(category.icon)} size={16} />
                </span>
                <span>{category.name}</span>
              </label>
            ))}
            <Button variant="quiet" icon="list" onClick={() => { setPicker("category"); }}>
              All categories
            </Button>
          </div>
          {categories.length === 0 ? <p className="note">You have no {kindLabels[draft.kind].toLowerCase()} categories yet. Add one from All categories.</p> : null}
          {errorText("category")}
        </fieldset>

        <div className="form-grid">
          <div className="form-field">
            <label htmlFor={ids.date}>Date</label>
            <input id={ids.date} type="date" min="2000-01-01" max="2100-12-31" value={draft.date} onChange={(event) => { set("date", event.currentTarget.value); }} {...invalid("date")} />
            {errorText("date")}
          </div>
          <div className="form-field">
            <label htmlFor={ids.account}>Account</label>
            <div className="field-with-action">
              <select id={ids.account} value={draft.accountId} onChange={(event) => { set("accountId", event.currentTarget.value); }} {...invalid("account")}>
                <option value="">No account</option>
                {ledger.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
                {draft.accountId && !ledger.accounts.some((account) => account.id === draft.accountId) ? <option value={draft.accountId}>Removed account</option> : null}
              </select>
              <Button variant="quiet" icon="add" onClick={() => { setPicker("account"); }}>
                New account
              </Button>
            </div>
            {errorText("account")}
          </div>
        </div>

        <button type="button" className="disclosure" aria-expanded={more} aria-controls={ids.more} onClick={() => { setMore((value) => !value); }}>
          <Icon name={more ? "chevron-down" : "chevron-forward"} size={16} weight={48} />
          More details
          <span className="note">{moreSummary(draft, ledger)}</span>
        </button>
        <div id={ids.more} className="more-details" hidden={!more}>
          {draft.kind === "expense" ? (
            <div className="shared-section">
              <ChoiceGroup<ShareMode>
                legend="Your share"
                name="entry-split"
                value={draft.split}
                onChange={(mode) => {
                  setDraft((previous) => ({ ...previous, split: mode, shareInput: mode === "equal" ? "2" : mode === "percent" ? "50" : mode === "full" ? "" : previous.shareInput }));
                }}
                options={[
                  { value: "full", label: "All mine" },
                  { value: "equal", label: "Split equally" },
                  { value: "amount", label: "Amount" },
                  { value: "percent", label: "Percent" },
                ]}
              />
              {shareMode !== "full" ? (
                <div className="form-field">
                  <label htmlFor={ids.share}>{SHARE_LABEL[shareMode]}</label>
                  <input id={ids.share} inputMode={shareMode === "equal" ? "numeric" : "decimal"} autoComplete="off" value={draft.shareInput} onChange={(event) => { set("shareInput", event.currentTarget.value); }} {...invalid("share")} />
                  {errorText("share")}
                </div>
              ) : null}
              <div className="your-share" role="status">
                <span>Your share · counts in your spending</span>
                <span className="pk-num">{preview ? money(preview.share) : "—"}</span>
              </div>
              <p className="note">Only your share counts in totals. To split with a household, add a shared expense from Shared.</p>
            </div>
          ) : null}
          <div className="form-grid">
            {target.kind === "new" ? (
              <div className="form-field">
                <label htmlFor={ids.repeat}>Repeat</label>
                <select id={ids.repeat} value={draft.repeat} onChange={(event) => { set("repeat", event.currentTarget.value as Repeat); }}>
                  <option value="none">Doesn't repeat</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
            ) : null}
            {showTrips ? (
              <div className="form-field">
                <label htmlFor={ids.trip}>Trip</label>
                <select id={ids.trip} value={draft.tripId} onChange={(event) => { set("tripId", event.currentTarget.value); }} {...invalid("trip")}>
                  <option value="">No trip</option>
                  {ledger.trips.map((trip) => (
                    <option key={trip.id} value={trip.id}>
                      {trip.name}
                    </option>
                  ))}
                </select>
                {errorText("trip")}
              </div>
            ) : null}
          </div>
          {draft.repeat !== "none" && target.kind === "new" ? <p className="note">This entry is the first one. Penny adds the next on its date, {draft.repeat}.</p> : null}
          {editing?.recurringId ? <p className="note">This entry came from a repeating schedule. Editing it changes only this one.</p> : null}
          <div className="form-field">
            <label htmlFor={ids.note}>Note</label>
            <textarea id={ids.note} maxLength={1000} value={draft.note} onChange={(event) => { set("note", event.currentTarget.value); }} {...invalid("note")} />
            {errorText("note")}
          </div>
          {draft.kind === "expense" ? (
            <ReceiptField
              value={draft.receipt}
              onChange={(receipt) => {
                set("receipt", receipt);
              }}
              onBusyChange={setReceiptBusy}
            />
          ) : null}
        </div>
      </form>
      {picker === "category" ? (
        <CategoryPickerDialog
          kind={draft.kind}
          categories={categories}
          selected={draft.categoryId}
          save={writer.save}
          onSelect={(id) => {
            if (id) set("categoryId", id);
          }}
          onClose={() => {
            setPicker(null);
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
    </Dialog>
  );
}

function moreSummary(draft: EntryDraft, ledger: Ledger): string {
  const parts: string[] = [];
  if (draft.kind === "expense" && draft.split !== "full") parts.push("Split");
  if (draft.repeat !== "none") parts.push(`Repeats ${draft.repeat}`);
  const trip = draft.kind === "expense" && draft.tripId ? ledger.trips.find((item) => item.id === draft.tripId) : undefined;
  if (trip) parts.push(trip.name);
  if (draft.note.trim()) parts.push("Note");
  if (draft.kind === "expense" && draft.receipt) parts.push("Receipt");
  return parts.length ? parts.join(" · ") : "Split, repeat, trip, note, receipt";
}

