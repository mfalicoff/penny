import { deleteEntry, saveEntry } from "@domain/commands.ts";
import type { Category, Transaction } from "@domain/ledger.ts";
import { isExpectedIncome } from "@domain/summary.ts";
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { useToday } from "../../app/useToday";
import { Badge, Button, cx } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { tileStyle } from "../../design/categoryTint";
import { ModalDialog } from "../../design/ModalDialog";
import { formatCents, Money } from "../../design/Money";
import { Banner, SaveErrorBanner, useToast } from "../../design/states";
import { rowAmount } from "../recurring/model";
import { ReceiptLink } from "../receipts/ReceiptLink";
import { categoryIcon, longDay, repeatLabel, splitSummary } from "./model";
import { EntryFormDialog } from "./EntryForm";
import { useLedgerWriter } from "./writer";

const TONE = { expense: "expense", income: "income", investment: "investment" } as const;

/** What the detail opens with: the entry alone, or straight into Edit or Delete (Activity's row actions and E / ⌫). */
export type EntryAction = "detail" | "edit" | "delete";

interface DetailProps {
  /** The row as Activity had it, used when the ledger doesn't have it (the demo). */
  entry: Transaction;
  onClose: () => void;
  initialAction?: EntryAction;
}

/**
 * One personal entry (`iphone-entry-detail`), opened from Activity as a dialog (MAZ-227's web
 * convention). It reads the entry from this browser's ledger, so a sync or another tab updates it
 * while open. Edit opens the form over it; Delete asks first (`iphone-delete-confirm`), goes
 * through the offline store and offers Undo.
 */
export function EntryDetailDialog({ entry, onClose, initialAction = "detail" }: DetailProps) {
  const titleId = useId();
  const editRef = useRef<HTMLButtonElement>(null);
  return (
    <EntryDetailFrame entry={entry} onClose={onClose} initialAction={initialAction}>
      {(sheet) => (
        <ModalDialog labelledBy={titleId} onClose={onClose} initialFocus={editRef} panelClassName="pk-dialog entry-sheet-dialog">
          {sheet({ titleId, editRef, layout: "dialog" })}
        </ModalDialog>
      )}
    </EntryDetailFrame>
  );
}

/**
 * The same entry beside Activity's list (`web-activity`'s right-hand panel, `ipad-activity`'s
 * detail pane), from 1100px. It is a labelled region, not a dialog: the list stays usable.
 *
 * - On a desktop (`web-activity`) the tile and Close lead, and Edit and Delete end the panel.
 * - On a touch tablet (`touch`, `ipad-activity`) the pane always shows the selected entry, so it
 *   has no Close: Delete and Edit lead it over a glow, the tile sits beside the title, and the
 *   Split group lists your share and the other people's. Saving an edit keeps the entry open;
 *   deleting it calls `onClose`, and Activity selects another entry.
 *
 * On a desktop the panel steps aside while Edit is open (`web-edit-entry`: Activity with nothing
 * selected behind the form), and `onEditing` tells Activity so, to drop the row's selection.
 */
export function EntryDetailPanel({ entry, onClose, initialAction = "detail", touch = false, onEditing }: DetailProps & { touch?: boolean; onEditing?: (editing: boolean) => void }) {
  const titleId = useId();
  const editRef = useRef<HTMLButtonElement>(null);
  return (
    <EntryDetailFrame entry={entry} onClose={onClose} initialAction={initialAction} keepOnSave={touch} onModeChange={onEditing ? (mode) => { onEditing(mode === "edit"); } : undefined}>
      {(sheet, mode) => (
        <aside className={touch ? "entry-panel entry-panel--pane" : "entry-panel"} aria-labelledby={titleId} hidden={!touch && mode === "edit"}>
          {touch ? <div className="entry-panel__glow" aria-hidden="true" /> : null}
          {sheet({ titleId, editRef, layout: touch ? "pane" : "panel" })}
        </aside>
      )}
    </EntryDetailFrame>
  );
}

interface SheetSlots {
  titleId: string;
  editRef: RefObject<HTMLButtonElement | null>;
  /**
   * `dialog` (`iphone-entry-detail`): Close, then Delete and Edit, over the tile.
   * `panel` (`web-activity`): the tile and Close lead, and Edit and Delete end the panel.
   * `pane` (`ipad-activity`): Delete and Edit, then the tile beside the title; no Close.
   */
  layout: "dialog" | "panel" | "pane";
}

/** The detail's content and its Edit and Delete flows, shared by the dialog and the panel. */
function EntryDetailFrame({
  entry: shown,
  onClose,
  initialAction,
  keepOnSave = false,
  onModeChange,
  children,
}: DetailProps & { initialAction: EntryAction; keepOnSave?: boolean; onModeChange?: ((mode: EntryAction) => void) | undefined; children: (sheet: (slots: SheetSlots) => ReactNode, mode: EntryAction) => ReactNode }) {
  const writer = useLedgerWriter();
  const toast = useToast();
  const today = useToday();
  const [mode, setMode] = useState<EntryAction>(initialAction);
  useEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);
  const live = writer.ledger?.transactions.find((item) => item.id === shown.id);
  const entry = live ?? shown;
  const gone = writer.ledger !== null && !live;
  const ledger = writer.ledger;
  const currency = ledger?.currency;
  const category = ledger?.categories.find((item) => item.id === entry.categoryId);
  const account = ledger?.accounts.find((item) => item.id === entry.accountId);
  const trip = ledger?.trips.find((item) => item.id === entry.tripId);
  const split = splitSummary(entry);
  const expected = isExpectedIncome(entry, today);
  const canWrite = Boolean(writer.save) && !gone;

  const sheet = ({ titleId, editRef, layout }: SheetSlots) => {
    const actionsOnTop = layout !== "panel";
    const pane = layout === "pane";
    const tile = (
      <span className="category-dot category-dot--large" style={tileStyle({ ...category, entryKind: entry.kind })}>
        <Icon name={categoryIcon(category?.icon)} size={26} />
      </span>
    );
    const closeButton = (
      <button type="button" className="wbtn wbtn--icon entry-sheet__close" aria-label="Close" onClick={onClose}>
        <Icon name="close" size={16} weight={44} />
      </button>
    );
    // `ipad-activity`: Delete and Edit are the pane's neutral glass toolbar buttons.
    const deleteButton = <Button variant={pane ? "secondary" : "danger-quiet"} className={pane ? "glass" : undefined} iconOnly icon="trash" aria-label="Delete" disabled={!canWrite} onClick={() => { setMode("delete"); }} />;
    const editButton = (
      <Button ref={editRef} variant="secondary" className={pane ? "glass" : undefined} icon="create" disabled={!canWrite} onClick={() => { setMode("edit"); }}>
        Edit
      </Button>
    );
    const head = (
      <div className="entry-sheet__head">
        <h2 id={titleId} className="entry-sheet__title">
          {entry.title}
        </h2>
        <p className="entry-sheet__sub">
          {category?.name ?? "Unknown category"} · <time dateTime={entry.date}>{longDay(entry.date, today)}</time>
        </p>
      </div>
    );
    return (
      <div className={cx("entry-sheet", actionsOnTop && "entry-sheet--actions-top", pane && "entry-sheet--pane")}>
        {pane ? (
          <>
            <div className="entry-sheet__top">
              <span className="entry-sheet__toolbar">
                {deleteButton}
                {editButton}
              </span>
            </div>
            <div className="entry-sheet__identity">
              {tile}
              {head}
            </div>
          </>
        ) : actionsOnTop ? (
          <>
            <div className="entry-sheet__top">
              {closeButton}
              <span className="entry-sheet__toolbar">
                {deleteButton}
                {editButton}
              </span>
            </div>
            {tile}
          </>
        ) : (
          <div className="entry-sheet__top">
            {tile}
            {closeButton}
          </div>
        )}
        {pane ? null : head}
        <p className="entry-sheet__amount">
          {/* Signed as the cards read it (MAZ-202): expenses −, income +, investments unsigned; expected income in amber, unsigned. */}
          {expected ? <Money cents={entry.share} currency={currency} tone="pending" /> : <Money {...rowAmount(entry.kind, entry.share)} currency={currency} tone={TONE[entry.kind]} />}
          {split ? <span className="entry-sheet__share">your share of {formatCents(entry.total, currency)}</span> : null}
        </p>
        {expected || writer.pending.has(entry.id) ? (
          <span className="entry-detail__badges">
            {expected ? (
              <Badge tone="pending" icon="time">
                Expected
              </Badge>
            ) : null}
            {writer.pending.has(entry.id) ? (
              <Badge tone="pending" icon="time">
                Waiting to sync
              </Badge>
            ) : null}
          </span>
        ) : null}
        {gone ? (
          <Banner tone="info" title="This entry isn't here any more">
            It was deleted on another device or in another tab.
          </Banner>
        ) : null}
        {writer.unavailable ? <p className="note">{writer.unavailable}</p> : null}

        <DetailGroup title="Details" titled={pane}>
          <DetailRow label="Account" value={account ? account.name : entry.accountId ? "Removed account" : null} />
          <DetailRow label="Repeats" value={repeatLabel(entry, ledger)} />
          {entry.kind === "expense" ? <DetailRow label="Trip" value={trip?.name ?? null} /> : null}
          {entry.note ? <DetailRow label="Note" value={entry.note} note /> : null}
        </DetailGroup>

        {split || entry.receipt ? (
          <DetailGroup title={pane ? (split ? "Split" : "Receipt") : split && entry.receipt ? "Split & receipt" : split ? "Split" : "Receipt"} aside={pane ? split?.method : undefined} titled={pane} list={false}>
            <div className="entry-sheet__split">
              {split && pane ? (
                <ShareRows people={split.people} share={entry.share} total={entry.total} currency={currency} />
              ) : split ? (
                <dl className="entry-sheet__rows">
                  <DetailRow label="Split" value={split.method} />
                  <DetailRow label="Your share" value={formatCents(entry.share, currency)} />
                  <DetailRow label="Total" value={formatCents(entry.total, currency)} />
                </dl>
              ) : null}
              {entry.receipt ? (
                <div className="entry-sheet__receipt">
                  <span className="entry-sheet__paper" aria-hidden="true">
                    <Icon name={entry.receipt.mime === "application/pdf" ? "document-text" : "receipt"} size={22} />
                  </span>
                  <ReceiptLink receipt={entry.receipt} />
                </div>
              ) : null}
            </div>
          </DetailGroup>
        ) : null}

        {actionsOnTop ? null : (
          <div className="entry-sheet__actions">
            {editButton}
            {deleteButton}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {children(sheet, mode)}
      {mode === "edit" && live ? (
        <EntryFormDialog
          target={{ kind: "edit", entry: live }}
          onClose={() => {
            setMode("detail");
          }}
          onSaved={() => {
            if (keepOnSave) setMode("detail");
            else onClose();
          }}
        />
      ) : null}
      {mode === "delete" && live ? (
        <DeleteEntryDialog
          entry={live}
          category={category}
          account={account?.name}
          onClose={() => {
            setMode("detail");
          }}
          onDeleted={(deleted, offline) => {
            toast.show({
              title: `${deleted.title} deleted`,
              ...(offline ? { detail: "Deleted on this device. It syncs when you're back online." } : {}),
              ...(writer.save
                ? {
                    onUndo: () => {
                      void writer.save?.(saveEntry(deleted)).catch(() => {
                        toast.show({ title: "Couldn't undo", detail: "The entry stays deleted.", tone: "error" });
                      });
                    },
                  }
                : {}),
            });
            onClose();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * A small upper-case label over one solid group, as the cards' DETAILS and SPLIT & RECEIPT, or
 * (`titled`, `ipad-activity`'s panels) a bold title with an optional note at its end ("Split",
 * then "Equally · 2 people").
 */
function DetailGroup({ title, aside, titled = false, list = true, children }: { title: string; aside?: string | undefined; titled?: boolean; list?: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <section className="entry-sheet__group" aria-labelledby={id}>
      <h3 id={id} className={titled ? "entry-sheet__heading" : "entry-sheet__label"} aria-label={aside ? `${title}, ${aside}` : undefined}>
        {title}
        {aside ? <span className="entry-sheet__heading-note">{aside}</span> : null}
      </h3>
      {list ? <dl className="entry-sheet__rows">{children}</dl> : children}
    </section>
  );
}

/**
 * `ipad-activity`'s split: your share with a check, then the other people's share (the total less
 * yours) with the people glyph, in secondary text. An equal split says how many others there are;
 * a custom share says "Other people", because a personal entry stores no names or head count then.
 */
function ShareRows({ people, share, total, currency }: { people: number | null; share: number; total: number; currency: string | undefined }) {
  const others = people === null ? "Other people" : people === 2 ? "1 other person" : `${String(people - 1)} other people`;
  return (
    <dl className="entry-shares">
      <div className="entry-shares__row">
        <dt>
          <span className="entry-shares__avatar" aria-hidden="true">
            <Icon name="checkmark" size={14} />
          </span>
          Your share
        </dt>
        <dd className="pk-num">{formatCents(share, currency)}</dd>
      </div>
      <div className="entry-shares__row entry-shares__row--others">
        <dt>
          <span className="entry-shares__avatar" aria-hidden="true">
            <Icon name="people" size={15} />
          </span>
          {others}
        </dt>
        <dd className="pk-num">{formatCents(total - share, currency)}</dd>
      </div>
    </dl>
  );
}

/** A label and its value; an empty value reads "None", dimmed as on the card. */
function DetailRow({ label, value, note }: { label: string; value: string | null; note?: boolean }) {
  return (
    <div className="entry-sheet__row">
      <dt>{label}</dt>
      <dd className={value === null ? "entry-sheet__none" : note ? "entry-detail__note" : undefined}>{value ?? "None"}</dd>
    </div>
  );
}

/**
 * Delete confirmation (`iphone-delete-confirm`): the entry's tile, 'Delete “Title”?' and its amount,
 * date and account, then the full-width Delete over Cancel. A centered dialog (MAZ-227). A stale
 * delete shows the latest version instead of deleting it.
 */
function DeleteEntryDialog({ entry, category, account, onClose, onDeleted }: { entry: Transaction; category: Category | undefined; account: string | undefined; onClose: () => void; onDeleted: (entry: Transaction, offline: boolean) => void }) {
  const writer = useLedgerWriter();
  const [base, setBase] = useState(entry);
  const [failure, setFailure] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const money = (value: number) => formatCents(value, writer.ledger?.currency);

  async function confirm() {
    if (busyRef.current || !writer.save) return;
    busyRef.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const receipt = await writer.save(deleteEntry(base));
      onDeleted(base, receipt.savedOffline);
    } catch (error) {
      const latest = writer.ledger?.transactions.find((item) => item.id === base.id);
      if (latest && JSON.stringify(latest) !== JSON.stringify(base)) {
        setStale(true);
        setBase(latest);
      } else setFailure(error instanceof Error ? error.message : "The entry couldn't be deleted.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const line = [money(base.total), shortDay(base.date), account ?? category?.name].filter(Boolean).join(" · ");
  return (
    <ConfirmDeleteDialog
      titleId={titleId}
      descriptionId={descriptionId}
      title={`Delete “${base.title}”?`}
      line={line}
      tile={
        <span className="category-dot category-dot--large" style={tileStyle({ ...category, entryKind: base.kind })}>
          <Icon name={categoryIcon(category?.icon)} size={24} />
        </span>
      }
      onClose={onClose}
      cancelRef={cancelRef}
      confirm={
        <Button variant="danger" busy={busy} onClick={() => void confirm()}>
          {busy ? "Deleting…" : stale ? "Delete anyway" : "Delete"}
        </Button>
      }
    >
      <p className="confirm-sheet__note">It's removed from your history and totals on every device.</p>
      {stale ? (
        <Banner tone="error" title="This entry changed on another device">
          Nothing was deleted. It's now {base.title}, {money(base.total)} on {base.date}. Delete anyway removes this latest version.
        </Banner>
      ) : null}
      {failure ? <SaveErrorBanner message={failure} /> : null}
    </ConfirmDeleteDialog>
  );
}

/** "Nov 1", as the delete confirmation's amount line reads a date. */
export function shortDay(date: string): string {
  const [year = 2000, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * The delete confirmation's layout (`iphone-delete-confirm`), shared by personal entries and
 * shared expenses: tile, title and amount line, the explanation, then the stacked destructive
 * button over Cancel. Focus starts on Cancel.
 */
export function ConfirmDeleteDialog({
  titleId,
  descriptionId,
  title,
  line,
  tile,
  aside,
  confirm,
  cancelRef,
  onClose,
  children,
}: {
  titleId: string;
  descriptionId: string;
  title: string;
  line: string;
  tile: ReactNode;
  /** Beside the title (the household's members). */
  aside?: ReactNode;
  confirm: ReactNode;
  cancelRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <ModalDialog labelledBy={titleId} describedBy={descriptionId} onClose={onClose} initialFocus={cancelRef} panelClassName="pk-dialog confirm-sheet">
      <div className="confirm-sheet__head">
        {tile}
        <div className="confirm-sheet__titles">
          <h2 id={titleId}>{title}</h2>
          <p id={descriptionId}>{line}</p>
        </div>
        {aside}
      </div>
      {children}
      <div className="confirm-sheet__actions">
        {confirm}
        <Button ref={cancelRef} variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </ModalDialog>
  );
}
