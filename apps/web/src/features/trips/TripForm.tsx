import { saveTrip } from "@domain/commands.ts";
import { uid, type Trip } from "@domain/ledger.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useId, useRef, useState, type RefObject, type SyntheticEvent } from "react";
import { ApiError } from "../../api/client";
import { archiveHousehold, createSharedTrip, householdsKey, refreshHousehold, updateSharedTrip } from "../../api/households";
import { useLedgerCurrency } from "../../offline/useLedgerCurrency";
import { invalidateSearch } from "../../api/search";
import { useAccountEmail } from "../../auth/account";
import { useIsDemo } from "../../demo/demo";
import { currencyInfo } from "@domain/currency.ts";
import { useMediaQuery, WIDE } from "../../app/useMediaQuery";
import { Avatar, Button, Kbd } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { Dialog } from "../../design/ModalDialog";
import { SaveErrorBanner, useOnline, useToast } from "../../design/states";
import { describeSharedError } from "../households/errors";
import { localDate } from "../households/model";
import { describeSaveError, detailOf, useLedgerWorkspace } from "../organize/workspace";
import { DateRowInput, DetailList, DetailRow, isMac } from "../entries/EntryParts";
import { CurrencyMenu } from "../entries/CurrencyMenu";
import { currencyUses } from "../entries/currency";
import { currencyPlural } from "../households/sharedCurrency";
import { outsideDatesNote, validateTrip, type SharedTrip, type TripDraft, type TripErrors, type TripField } from "./model";

export type TripFormTarget = { kind: "new" } | { kind: "personal"; trip: Trip; expenseCount: number } | { kind: "shared"; household: SharedTrip };

const FIELDS: TripField[] = ["name", "startDate", "endDate"];

/**
 * New trip or Edit trip (specimen `trip-form`, card `iphone-trip-form`). A personal trip is saved
 * to this browser's durable ledger, so it works offline; turning on "Share with others" creates a
 * shared trip on the server instead (online only) and opens People to invite. A shared trip's
 * creator edits its name and dates here. Expenses dated outside the range still belong to the trip.
 */
export function TripFormDialog({ target, onClose }: { target: TripFormTarget; onClose: () => void }) {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const online = useOnline();
  const demo = useIsDemo();
  const workspace = useLedgerWorkspace();
  const currency = useLedgerCurrency({ enabled: target.kind === "new" && !demo });
  const wide = useMediaQuery(WIDE);
  // MAZ-151 phase 2: the trip's currency, chosen here (null: the home currency). A personal trip keeps
  // it in the ledger; a new shared trip sends it. A shared trip's can't change, so it's shown read-only.
  const [chosen, setChosen] = useState<string | null>(target.kind === "personal" ? (target.trip.currency ?? null) : null);
  const initial: TripDraft =
    target.kind === "personal"
      ? { name: target.trip.name, startDate: target.trip.startDate, endDate: target.trip.endDate }
      : target.kind === "shared"
        ? { name: target.household.name, startDate: target.household.trip.startDate, endDate: target.household.trip.endDate }
        : { name: "", startDate: localDate(), endDate: localDate() };
  const [draft, setDraft] = useState<TripDraft>(initial);
  const [share, setShare] = useState(false);
  const [errors, setErrors] = useState<TripErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);
  const focus = (field: TripField) => {
    const refs: Record<TripField, RefObject<HTMLInputElement | null>> = { name: nameRef, startDate: startRef, endDate: endRef };
    refs[field].current?.focus();
  };
  const ids = { name: useId(), startDate: useId(), endDate: useId(), note: useId(), when: useId(), people: useId(), share: useId(), shareHint: useId() };
  /** The field's error, or the note it's described by. */
  const invalid = (field: TripField, describedBy?: string) =>
    errors[field] ? { "aria-invalid": true, "aria-describedby": `${ids[field]}-error` } : describedBy ? { "aria-describedby": describedBy } : {};
  // The home currency, then the trip's: the household's once shared, else the one chosen here.
  const home = currency.data ?? workspace.ledger?.currency;
  const tripCurrency = target.kind === "shared" ? target.household.currency : (chosen ?? home);
  const formId = useId();

  const shared = target.kind === "shared" || share;
  const title = target.kind === "new" ? "New trip" : target.kind === "shared" ? "Edit shared trip" : "Edit trip";

  const sharedWrite = useMutation({
    mutationKey: ["trips", target.kind === "shared" ? "update" : "create"],
    mutationFn: (value: TripDraft) =>
      target.kind === "shared"
        ? updateSharedTrip(target.household.id, { name: value.name.trim(), startDate: value.startDate, endDate: value.endDate })
        : createSharedTrip({ name: value.name.trim(), currency: chosen ?? currency.data ?? "", startDate: value.startDate, endDate: value.endDate }),
    onSuccess: async ({ household }) => {
      if (target.kind === "shared") {
        await refreshHousehold(queryClient, email, household.id);
        toast.show({ title: `${household.name} saved`, detail: "Expenses keep their dates; nobody's share changed." });
        onClose();
        return;
      }
      await Promise.all([queryClient.invalidateQueries({ queryKey: householdsKey(email) }), invalidateSearch(queryClient, email)]);
      toast.show({ title: `${household.name} created`, detail: "Invite people from People." });
      onClose();
      void navigate({ to: "/trips/$id", params: { id: household.id }, search: { tab: "people" } });
    },
  });

  function set(field: TripField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function check(): boolean {
    const found = validateTrip(draft);
    setErrors(found);
    const first = FIELDS.find((field) => found[field]);
    if (first) {
      focus(first);
      return false;
    }
    return true;
  }

  async function savePersonal(remove = false) {
    if (saving) return;
    if (!remove && !check()) return;
    const original = target.kind === "personal" ? target.trip : undefined;
    const item: Trip = {
      id: original?.id ?? uid(),
      name: draft.name.trim(),
      startDate: draft.startDate,
      endDate: draft.endDate,
      ...(original?.sharedHouseholdId ? { sharedHouseholdId: original.sharedHouseholdId } : {}),
      // Contract 2.6.0: kept only when it isn't the home currency (the default).
      ...(chosen && chosen !== workspace.ledger?.currency ? { currency: chosen } : {}),
    };
    setSaving(true);
    setFailure(null);
    try {
      const receipt = await workspace.save(remove && original ? saveTrip(original, original, true) : saveTrip(item, original));
      toast.show({ title: remove ? `${item.name} deleted` : `${item.name} saved`, ...detailOf(receipt) });
      onClose();
      if (remove) void navigate({ to: "/trips" });
      else if (!original) void navigate({ to: "/trips/$id", params: { id: item.id } });
    } catch (error) {
      const message = describeSaveError(error);
      if (/already have a trip with this name/i.test(message)) {
        setErrors({ name: "You already have a trip with this name." });
        focus("name");
      } else setFailure(message);
    } finally {
      setSaving(false);
    }
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shared) {
      void savePersonal();
      return;
    }
    if (!check() || sharedWrite.isPending) return;
    if (target.kind === "new" && !(chosen ?? currency.data)) return;
    sharedWrite.mutate(draft);
  }

  const busy = saving || sharedWrite.isPending;
  const shareBlocked = demo ? "The demo can't share trips." : !online ? "Sharing needs a connection. You can still save a personal trip offline." : currency.isError ? "Penny couldn't read your ledger currency, so it can't share a trip right now." : null;
  const sharedFailure = sharedWrite.isError ? describeSharedError(sharedWrite.error).message : null;

  if (confirmDelete && target.kind === "personal") {
    return (
      <Dialog
        title={`Delete ${target.trip.name}?`}
        description="The trip goes away on every device. It has no expenses, so nothing else changes."
        onClose={() => { setConfirmDelete(false); }}
        actions={
          <>
            <Button variant="quiet" onClick={() => { setConfirmDelete(false); }}>
              Keep trip
            </Button>
            <Button variant="danger" busy={saving} onClick={() => void savePersonal(true)}>
              {saving ? "Deleting…" : "Delete trip"}
            </Button>
          </>
        }
      >
        {failure ? <SaveErrorBanner message={failure} /> : null}
      </Dialog>
    );
  }

  return (
    <Dialog
      title={title}
      onClose={onClose}
      initialFocus={nameRef}
      className={wide ? "trip-form-dialog trip-form-dialog--desktop" : "trip-form-dialog"}
      // `web-trip-form-currency`: the footer says how to save and cancel from the keyboard.
      hint={
        wide ? (
          <>
            <Kbd>{isMac() ? "⌘↵" : "Ctrl ↵"}</Kbd> save · <Kbd>Esc</Kbd> cancel
          </>
        ) : null
      }
      actions={
        <>
          {target.kind === "personal" ? (
            <Button
              variant="danger-quiet"
              icon="trash"
              style={{ marginInlineEnd: "auto" }}
              disabled={target.expenseCount > 0}
              aria-describedby={target.expenseCount > 0 ? `${ids.note}-delete` : undefined}
              onClick={() => { setConfirmDelete(true); }}
            >
              Delete trip
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" busy={busy || (shared && target.kind === "new" && !(chosen ?? currency.data))} aria-keyshortcuts="Meta+Enter Control+Enter">
            {busy ? "Saving…" : target.kind === "new" ? "Create trip" : "Save changes"}
            {wide ? <Kbd>{isMac() ? "⌘↵" : "Ctrl ↵"}</Kbd> : null}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="form trip-form"
        onSubmit={onSubmit}
        noValidate
        aria-label={title}
        onKeyDown={(event) => {
          // ⌘↵ / Ctrl+Enter saves from any field, as in the entry form.
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.currentTarget.requestSubmit();
          }
        }}
      >
        {failure ? <SaveErrorBanner message={failure} onRetry={() => void savePersonal()} retrying={saving} /> : null}
        {sharedFailure ? <SaveErrorBanner message={sharedFailure} /> : null}
        <div className="trip-form__name">
          <label htmlFor={ids.name} className="visually-hidden">
            Trip name
          </label>
          <input
            id={ids.name}
            ref={nameRef}
            type="text"
            className="trip-form__name-input"
            placeholder="Trip name"
            maxLength={80}
            autoComplete="off"
            value={draft.name}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? `${ids.name}-error` : undefined}
            onChange={(event) => { set("name", event.currentTarget.value); }}
          />
          {errors.name ? (
            <span id={`${ids.name}-error`} className="form-error">
              {errors.name}
            </span>
          ) : null}
        </div>

        <section className="trip-form__group" aria-labelledby={ids.when}>
          <h3 id={ids.when} className="trip-form__label">
            When
          </h3>
          <DetailList>
            <DetailRow icon="calendar" label="Starts" htmlFor={ids.startDate} {...(wide ? { chevron: "down" as const } : {})}>
              <span className="trip-form__date">
                <DateRowInput id={ids.startDate} inputRef={startRef} value={draft.startDate} text={formDate(draft.startDate)} today={localDate()} long onChange={(value) => { set("startDate", value); }} invalid={invalid("startDate")} />
              </span>
            </DetailRow>
            <DetailRow icon="calendar" label="Ends" htmlFor={ids.endDate} {...(wide ? { chevron: "down" as const } : {})}>
              <span className="trip-form__date">
                <DateRowInput id={ids.endDate} inputRef={endRef} value={draft.endDate} text={formDate(draft.endDate)} today={localDate()} long onChange={(value) => { set("endDate", value); }} invalid={invalid("endDate", ids.note)} />
              </span>
            </DetailRow>
            <DetailRow icon="cash" label="Currency">
              {target.kind === "shared" || !home || !tripCurrency ? (
                // A shared trip's currency is its balances' and can't change once created (the API has no way to).
                <span className="trip-form__currency">
                  <CurrencyName code={tripCurrency} />
                  {target.kind === "shared" ? (
                    <>
                      <Icon name="lock-closed" size={15} />
                      <span className="visually-hidden">, can't be changed</span>
                    </>
                  ) : null}
                </span>
              ) : (
                <CurrencyMenu
                  className="trip-form__currency-menu"
                  code={tripCurrency}
                  home={home}
                  recent={workspace.ledger ? currencyUses(workspace.ledger).map((use) => use.code) : []}
                  locked={null}
                  named
                  onPick={(next) => {
                    setChosen(next === home ? null : next);
                  }}
                />
              )}
            </DetailRow>
          </DetailList>
          {errors.startDate ? (
            <span id={`${ids.startDate}-error`} className="form-error">
              {errors.startDate}
            </span>
          ) : null}
          {errors.endDate ? (
            <span id={`${ids.endDate}-error`} className="form-error">
              {errors.endDate}
            </span>
          ) : null}
          <p id={ids.note} className="trip-form__hint">
            {tripCurrency ? `${currencyNote(tripCurrency, shared)} ` : ""}
            {outsideDatesNote(draft.startDate)}
          </p>
        </section>

        {target.kind === "new" ? (
          <section className="trip-form__group" aria-labelledby={ids.people}>
            <h3 id={ids.people} className="trip-form__label">
              People
            </h3>
            <DetailList>
              <DetailRow icon="people" label="Share with others" htmlFor={ids.share}>
                <input
                  id={ids.share}
                  type="checkbox"
                  role="switch"
                  className="switch"
                  checked={share}
                  disabled={Boolean(shareBlocked)}
                  aria-describedby={ids.shareHint}
                  onChange={(event) => { setShare(event.currentTarget.checked); }}
                />
              </DetailRow>
              {/* `iphone-trip-form` lists you and the invite under the switch; `web-trip-form-currency` says it in the hint. */}
              {share && !wide ? (
                <>
                  <div className="entry-row trip-form__person">
                    <Avatar name={email || "You"} size={30} />
                    <span className="entry-row__label">You</span>
                    <span className="entry-row__value">Organizer</span>
                  </div>
                  <div className="entry-row trip-form__invite">
                    <Icon name="person-add" size={18} />
                    <span className="entry-row__label">Invite with a code</span>
                    <span className="entry-row__value">after saving</span>
                  </div>
                </>
              ) : null}
            </DetailList>
            <p id={ids.shareHint} className="trip-form__hint">
              {shareBlocked ??
                (share
                  ? wide
                    ? "Everyone in a shared trip sees its shared expenses and their own share, each in their own currency. You can invite people after saving."
                    : "Everyone in a shared trip sees its shared expenses and their own share. Anything you added before sharing stays private to you."
                  : "Only you see a personal trip. You can share it later; what you add before sharing stays private.")}
            </p>
          </section>
        ) : target.kind === "shared" ? (
          <p className="trip-form__hint">Only you, the organizer, can change the name and dates. Changing them never moves an expense or changes anyone's share.</p>
        ) : target.trip.sharedHouseholdId ? (
          <p className="trip-form__hint">This trip was shared. Its expenses here stay private to you.</p>
        ) : null}
        {target.kind === "personal" && target.expenseCount > 0 ? (
          <p id={`${ids.note}-delete`} className="form-hint">
            {target.expenseCount === 1 ? "1 expense is" : `${String(target.expenseCount)} expenses are`} assigned to this trip. Move them to another trip or no trip before deleting it.
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

/**
 * Under the dates (`web-trip-form-currency`, `iphone-trip-form-currency`): what the trip's currency
 * does. A personal trip has no payments to suggest.
 */
function currencyNote(code: string, shared: boolean): string {
  const plural = currencyPlural(code);
  return shared
    ? `New trip expenses start in ${plural}, and payments are suggested in ${plural}. Any expense can use another currency.`
    : `New trip expenses start in ${plural}. Any expense can use another currency.`;
}

/** "EUR Euro": a currency's code and name, as the trip form's Currency row shows it. */
function CurrencyName({ code }: { code: string | undefined }) {
  if (!code) return <>…</>;
  return (
    <>
      <b>{code}</b> {currencyInfo(code)?.name ?? ""}
    </>
  );
}

/** "Nov 12, 2026": the trip form's dates (card `iphone-trip-form`). */
function formDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Choose a date";
  const [year = 2000, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * Share a personal trip (specimen `share-personal-trip`). Creates a shared trip with the same name
 * and dates and links the personal trip to it. Expenses already on the personal trip stay private:
 * they are never sent to the server's shared trip, and only you see them, under "Only you". If the
 * link can't be saved here, the new shared trip is archived again so nothing is left half done.
 */
export function ShareTripDialog({ trip, expenseCount, onClose }: { trip: Trip; expenseCount: number; onClose: () => void }) {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const online = useOnline();
  const workspace = useLedgerWorkspace();
  const currency = useLedgerCurrency();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const share = useMutation({
    mutationKey: ["trips", "share"],
    mutationFn: async () => {
      // MAZ-151 phase 2: a personal trip with its own currency is shared in it.
      const { household } = await createSharedTrip({ name: trip.name, currency: trip.currency ?? currency.data ?? "", startDate: trip.startDate, endDate: trip.endDate });
      try {
        await workspace.save(saveTrip({ ...trip, sharedHouseholdId: household.id }, trip));
      } catch (error) {
        // Undo the server half: the trip is new and empty, so archiving it is always allowed.
        const undone = await archiveHousehold(household.id).then(
          () => true,
          () => false,
        );
        if (undone) throw error;
        // Both halves failed: say so, rather than let a retry create a second trip beside it.
        throw new Error(`${household.name} was created as a shared trip, but Penny couldn't link it to your trip or remove it again. Open it from Trips and archive it from People before sharing again.`, { cause: error });
      }
      return household;
    },
    // A trip left behind by a failed undo shows up in Trips straight away.
    onError: () => queryClient.invalidateQueries({ queryKey: householdsKey(email) }),
    onSuccess: async (household) => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: householdsKey(email) }), invalidateSearch(queryClient, email)]);
      toast.show({ title: `${household.name} is shared`, detail: "What you added before stays private to you." });
      onClose();
      void navigate({ to: "/trips/$id", params: { id: household.id }, search: { tab: "people" }, replace: true });
    },
  });
  const failure = share.isError ? (share.error instanceof ApiError ? describeSharedError(share.error).message : describeSaveError(share.error)) : null;
  const blocked = !online ? "Sharing needs a connection. Nothing was sent." : currency.isError ? "Penny couldn't read your ledger currency, so it can't share this trip right now." : null;
  return (
    <Dialog
      title={`Share ${trip.name}?`}
      onClose={onClose}
      initialFocus={confirmRef}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button ref={confirmRef} variant="primary" icon="person-add" busy={share.isPending || !currency.data} disabled={Boolean(blocked)} onClick={() => { share.mutate(); }}>
            {share.isPending ? "Sharing…" : "Share trip"}
          </Button>
        </>
      }
    >
      {failure ? <SaveErrorBanner message={failure} /> : null}
      {blocked ? <p className="form-error">{blocked}</p> : null}
      <ul className="trip-share-points">
        <li>
          <strong>A shared trip with the same name and dates.</strong> You're the organizer and invite people with a code.
        </li>
        <li>
          <strong>
            {expenseCount === 0 ? "Nothing to move." : expenseCount === 1 ? "Your 1 expense stays private." : `Your ${String(expenseCount)} expenses stay private.`}
          </strong>{" "}
          What you added before sharing is shown only to you, under Only you. Add trip expenses afterwards to split them with everyone.
        </li>
        <li>
          <strong>Balances settle by month.</strong> Like a household, each month is settled on its own, and expenses can be dated outside the trip.
        </li>
      </ul>
    </Dialog>
  );
}
