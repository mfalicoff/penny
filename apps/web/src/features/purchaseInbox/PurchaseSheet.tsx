import { convertAmount, parseAmount } from "@domain/currency.ts";
import type { Category, Ledger } from "@domain/ledger.ts";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState, type KeyboardEvent, type SyntheticEvent } from "react";
import { ApiError } from "../../api/client";
import type { PurchaseInboxItem } from "../../api/schemas";
import { useAccountEmail, useAccountMe } from "../../auth/account";
import { categoryTint } from "../../design/categoryTint";
import { Button, Kbd } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { formatCents } from "../../design/Money";
import { Banner, useToast } from "../../design/states";
import { currencySymbolFor, displayRate, formatMinor } from "../entries/currency";
import { ConversionLine } from "../entries/ConversionLine";
import { AmountHero, CategoryChips, DateRowInput, DetailList, DetailRow, EntryDialog, isMac, useEntryLayout } from "../entries/EntryParts";
import { categoryIcon, mostUsedCategories, today, type EntryDraft } from "../entries/model";
import { CategoryPickerDialog } from "../entries/pickers";
import { RateRow, useRateLookup, useShownRate, type RateMode } from "../entries/RateRow";
import { useHouseholdChoices } from "../entries/scope";
import type { LedgerWriter } from "../entries/writer";
import { accountForCard, capturedText, suggestCategory } from "./model";
import { addPersonal, addShared, afterTriage, purchaseDraft, TriageError } from "./triage";
import { useCardAccounts } from "./usePurchases";

/**
 * Add a captured purchase (cards `web-capture-add`, `web-capture-split`): the amount it was paid
 * in, with the converted home amount at the purchase day's rate; the merchant as the title; the
 * suggested category first ("Suggested from your last Steam entry"); the card's account; and
 * where it goes: Just me, a household or a shared trip (split equally, paid by you). Discard,
 * Cancel, and Add expense or Add to <household> (⌘↵).
 */
export function PurchaseSheet({
  item,
  writer,
  onClose,
  onDiscard,
}: {
  item: PurchaseInboxItem;
  writer: LedgerWriter & { ledger: Ledger };
  onClose: () => void;
  onDiscard: () => void;
}) {
  const ledger = writer.ledger;
  const email = useAccountEmail();
  const me = useAccountMe();
  const queryClient = useQueryClient();
  const toast = useToast();
  const layout = useEntryLayout();
  const cards = useCardAccounts();
  const choices = useHouseholdChoices();
  const [draft, setDraft] = useState<EntryDraft>(() => purchaseDraft(ledger, item, cards));
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const formId = useId();
  const ids = { amount: useId(), title: useId(), category: useId(), date: useId(), account: useId(), rate: useId(), split: useId(), trip: useId(), suggested: useId() };

  // The account the card is mapped to is applied once the mapping arrives, unless one was chosen.
  const mapped = accountForCard(cards, item.card, ledger);
  const [accountTouched, setAccountTouched] = useState(false);
  if (!accountTouched && mapped && draft.accountId !== mapped) setDraft((previous) => ({ ...previous, accountId: mapped }));

  const household = householdId ? choices.find((choice) => choice.id === householdId) : undefined;
  const base = household?.currency ?? ledger.currency;
  const code = item.currency;
  const foreign = code !== base;
  const lookup = useRateLookup(base, code, draft.date, foreign);
  const shown = useShownRate(lookup);
  const rateMode: RateMode = !foreign
    ? { mode: "loading" }
    : lookup.state === "manual" && draft.rateInput === null
      ? { mode: "manual", reason: lookup.reason }
      : draft.rateInput !== null
        ? { mode: "edited", published: lookup.state === "rate" ? lookup.rate : null }
        : lookup.state === "rate"
          ? { mode: "auto", rate: lookup.rate, refreshing: false }
          : shown.rate
            ? { mode: "auto", rate: shown.rate, refreshing: true }
            : { mode: "loading" };
  const rate = !foreign ? null : draft.rateInput !== null ? validRate(draft.rateInput) : rateMode.mode === "auto" ? rateMode.rate.rate : null;

  const suggestion = suggestCategory(ledger, item.merchant);
  const expenseCategories = ledger.categories.filter((category) => category.kind === "expense");
  const chips = chipCategories(ledger, draft.categoryId, suggestion?.category);
  const suggested = suggestion?.source === "last" && draft.categoryId === suggestion.category.id;
  const category = expenseCategories.find((choice) => choice.id === draft.categoryId);
  const set = <K extends keyof EntryDraft>(key: K, value: EntryDraft[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
  };

  const homes = choices.filter((choice) => !choice.trip);
  const trips = choices.filter((choice) => choice.trip);
  const canSplit = Boolean(me.userId) && homes.length > 0;
  const amountMinor = safeAmount(draft.amount, code);
  const total = amountMinor === null ? null : foreign ? (rate ? convertAmount(amountMinor, code, rate, base) : null) : amountMinor;
  const share = household && total !== null ? Math.floor(total / Math.max(1, household.memberCount)) : null;

  async function submit() {
    if (busy) return;
    setFailure(null);
    setBusy(true);
    try {
      if (household) {
        if (!me.userId) throw new TriageError("Sign in again to split this purchase.");
        if (!category) throw new TriageError("Choose a category.");
        if (total === null || total <= 0) throw new TriageError(foreign ? "Enter the exchange rate." : "Enter an amount greater than zero.");
        const title = draft.title.trim();
        if (!title) throw new TriageError("Add a name for this expense.");
        await addShared(item, household, {
          title: title.slice(0, 100),
          totalCents: total,
          payerUserId: me.userId,
          category: { name: category.name, icon: category.icon, color: category.color },
          date: draft.date,
          accountId: draft.accountId || undefined,
        });
        toast.show({ title: `Added to ${household.name}`, detail: `${title} · ${formatCents(total, base)}` });
      } else {
        const looked = rateMode.mode === "auto" ? { rate: rateMode.rate.rate, status: rateMode.rate.status, rateDate: rateMode.rate.rateDate } : null;
        const { offline } = await addPersonal(writer, item, draft, looked);
        toast.show({
          title: "Expense added",
          detail: offline ? "Saved on this device. It syncs when you're back online." : `${draft.title.trim()} · ${formatMinor(item.amount, code, ledger.currency)}`,
          tile: { icon: categoryIcon(category?.icon), color: categoryTint({ ...category, entryKind: "expense" }) },
        });
      }
      await afterTriage(queryClient, email, household?.id);
      onClose();
    } catch (error) {
      setFailure(failureText(error));
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }
  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  }

  const discardButton = (
    <Button variant="danger-quiet" icon="trash" className="purchase-discard" onClick={onDiscard}>
      Discard
    </Button>
  );
  const primaryLabel = household ? `Add to ${household.name}` : "Add expense";
  const mac = isMac();
  const main = (
    <>
      <AmountHero
        id={ids.amount}
        value={draft.amount}
        onChange={(value) => {
          set("amount", value);
        }}
        currency={code}
        symbol={currencySymbolFor(code, base)}
        currencyPill={false}
        kind="expense"
        conversion={foreign ? <ConversionLine amount={draft.amount} code={code} rate={rate} home={base} loading={rateMode.mode === "loading"} /> : null}
      />
      <p className="purchase-sheet__source">
        <Icon name="card" size={14} />
        <span>{["Apple Pay", item.card, capturedText(item.capturedAt)].filter(Boolean).join(" · ")}</span>
      </p>
      <div className="entry-title">
        <label htmlFor={ids.title} className="visually-hidden">
          Title
        </label>
        <input id={ids.title} ref={titleRef} className="input" maxLength={100} autoComplete="off" value={draft.title} onChange={(event) => { set("title", event.currentTarget.value); }} />
      </div>
      <div className="purchase-sheet__category">
        <div className="purchase-sheet__category-head">
          <span className="entry-label" aria-hidden="true">
            Category
          </span>
          {suggested ? (
            <span id={ids.suggested} className="purchase-sheet__suggested">
              Suggested from your last {item.merchant} entry
            </span>
          ) : null}
        </div>
        <CategoryChips
          id={ids.category}
          name="purchase-category"
          {...(suggested ? { describedBy: ids.suggested } : {})}
          categories={chips.map((choice) => ({ key: choice.id, name: choice.name, tint: { id: choice.id, color: choice.color, entryKind: "expense" }, icon: choice.icon }))}
          selected={draft.categoryId}
          onChoose={(id) => {
            set("categoryId", id);
          }}
          onAll={() => {
            setPicker(true);
          }}
          empty={expenseCategories.length === 0 ? <p className="note">You have no expense categories yet. Add one from All categories.</p> : null}
        />
      </div>
      {household ? (
        <section className="purchase-sheet__shared" aria-label={`In ${household.name}`}>
          <h3 className="entry-label">In {household.name}</h3>
          <DetailList>
            <DetailRow icon="person-add" label="Paid by">
              You
            </DetailRow>
            <DetailRow icon="options" label="Split">
              Equally, {household.memberCount} {household.memberCount === 1 ? "person" : "people"}
            </DetailRow>
            <DetailRow icon="cash" label="Your share">
              <b className="pk-num">{share === null ? "—" : formatCents(share, base)}</b>
            </DetailRow>
          </DetailList>
        </section>
      ) : null}
    </>
  );

  // The card's account with "From your <card> card" (web-capture-add); a plain menu when split (web-capture-split).
  const showMapped = Boolean(mapped && draft.accountId === mapped && item.card && !household);
  const accountName = ledger.accounts.find((account) => account.id === draft.accountId)?.name;
  const details = (
    <DetailList label="Details">
      <DetailRow icon="calendar" label="Date" htmlFor={ids.date} chevron="down">
        <DateRowInput id={ids.date} value={draft.date} onChange={(value) => { set("date", value); }} today={today()} long={false} />
      </DetailRow>
      <DetailRow icon="card" label="Account" htmlFor={ids.account} {...(showMapped ? {} : { chevron: "down" as const })}>
        {showMapped ? (
          <span className="purchase-sheet__mapped">
            <b>{accountName}</b>
            <small>From your {item.card} card</small>
          </span>
        ) : null}
        <select
          id={ids.account}
          className={showMapped ? "entry-row__select purchase-sheet__overlay" : "entry-row__select"}
          value={draft.accountId}
          onChange={(event) => {
            setAccountTouched(true);
            set("accountId", event.currentTarget.value);
          }}
        >
          <option value="">None</option>
          {ledger.accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </DetailRow>
      {foreign ? (
        <RateRow
          id={ids.rate}
          code={code}
          home={base}
          state={rateMode}
          input={draft.rateInput}
          onInput={(value) => {
            set("rateInput", value);
          }}
          onEdit={() => {
            if (rateMode.mode === "auto") set("rateInput", displayRate(rateMode.rate.rate));
            setTimeout(() => {
              document.getElementById(ids.rate)?.focus();
            }, 0);
          }}
        />
      ) : null}
      <DetailRow icon="people" label="Split" htmlFor={ids.split} chevron="down" {...(household ? { className: "purchase-sheet__split--on" } : {})}>
        <select
          id={ids.split}
          className="entry-row__select"
          value={householdId ?? ""}
          disabled={!canSplit && trips.length === 0}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setHouseholdId(value || null);
            set("rateInput", null);
          }}
        >
          <option value="">Just me</option>
          {canSplit && homes.length ? (
            <optgroup label="Households">
              {homes.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          {me.userId && trips.length ? (
            <optgroup label="Trips">
              {trips.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.name}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </DetailRow>
      {household ? null : (
        <DetailRow icon="airplane" label="Trip" htmlFor={ids.trip} chevron="down">
          <select id={ids.trip} className="entry-row__select" value={draft.tripId} onChange={(event) => { set("tripId", event.currentTarget.value); }}>
            <option value="">None</option>
            {ledger.trips.map((trip) => (
              <option key={trip.id} value={trip.id}>
                {trip.name}
              </option>
            ))}
          </select>
        </DetailRow>
      )}
      {household ? null : (
        <DetailRow icon="receipt" label="Receipt">
          None
        </DetailRow>
      )}
    </DetailList>
  );

  return (
    <EntryDialog
      layout={layout}
      title="Purchase"
      onClose={onClose}
      initialFocus={primaryRef}
      className="purchase-sheet"
      form={{ id: formId, onSubmit, "aria-busy": busy }}
      onKeyDown={onKeyDown}
      hint={<span className="pk-dialog__hint">{discardButton}</span>}
      secondary={
        layout === "phone" ? (
          <>
            {discardButton}
            <Button onClick={onClose}>Cancel</Button>
          </>
        ) : (
          <Button onClick={onClose}>Cancel</Button>
        )
      }
      primary={
        <Button ref={primaryRef} type="submit" variant="primary" busy={busy}>
          {primaryLabel} <Kbd>{mac ? "⌘↵" : "Ctrl ↵"}</Kbd>
        </Button>
      }
      notices={
        failure ? (
          <Banner tone="error" title="Not added">
            {failure}
          </Banner>
        ) : null
      }
      main={main}
      details={details}
    >
      {picker ? (
        <CategoryPickerDialog
          kind="expense"
          categories={expenseCategories}
          mostUsed={mostUsedCategories(ledger, "expense")}
          selected={draft.categoryId}
          onSelect={(id) => {
            if (id) set("categoryId", id);
            setPicker(false);
          }}
          onClose={() => {
            setPicker(false);
          }}
          save={writer.save}
        />
      ) : null}
    </EntryDialog>
  );
}

/** The suggested category first, then the chosen one, then the most used: three chips, then All. */
function chipCategories(ledger: Pick<Ledger, "categories" | "transactions">, selected: string, suggested: Category | undefined): Category[] {
  const out: Category[] = [];
  const add = (category: Category | undefined) => {
    if (category && category.kind === "expense" && !out.some((item) => item.id === category.id)) out.push(category);
  };
  add(suggested);
  add(ledger.categories.find((category) => category.id === selected));
  for (const category of mostUsedCategories(ledger, "expense", 6)) add(category);
  for (const category of ledger.categories) add(category);
  return out.slice(0, 3);
}

function safeAmount(value: string, code: string): number | null {
  try {
    const amount = parseAmount(value, code);
    return amount > 0 ? amount : null;
  } catch {
    return null;
  }
}

function validRate(value: string): string | null {
  const trimmed = value.trim();
  return /^\d{1,9}(\.\d{1,8})?$/.test(trimmed) && Number(trimmed) > 0 ? trimmed : null;
}

export function failureText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return "Penny can't reach the server. Try again when you're back online.";
    if (error.status === 404) return "This purchase isn't in your Inbox any more.";
    if (error.status === 409) return "This purchase was already handled on another device.";
    return error.message || "Something went wrong. Try again in a moment.";
  }
  return error instanceof Error ? error.message : "Something went wrong. Try again in a moment.";
}

