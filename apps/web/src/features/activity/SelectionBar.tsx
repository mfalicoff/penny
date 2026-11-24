import type { Transaction } from "@domain/ledger.ts";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Button, cx } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { tileStyle } from "../../design/categoryTint";
import { Dialog } from "../../design/ModalDialog";
import { Money } from "../../design/Money";
import { SaveErrorBanner, useToast } from "../../design/states";
import { categoryIcon } from "../entries/model";
import { useLedgerWriter } from "../entries/writer";
import { shortDay } from "../entries/EntryDetail";
import { rowAmount } from "../recurring/model";
import { BULK_ACTIONS, entries, restoreEntries, selectionTotals, type BulkAction, type BulkOutcome, type ConfirmAction, type PickAction, type Selection } from "./bulkActions";

const TONE = { expense: "expense", income: "income", investment: "investment" } as const;

/** How many entries the delete confirmation lists before "and N more". */
const LISTED = 5;

const message = (error: unknown) => (error instanceof Error ? error.message.replace(/ Your draft is still here\.$/, "") : "That couldn't be saved. Try again.");

interface BarProps {
  selection: Selection;
  /** Clears the selection (Clear, Esc, the bar's checkbox). */
  onClear: () => void;
  /** After an action is saved, with the entries as they were before it. */
  onDone: (action: BulkAction, before: Transaction[]) => void;
  /** Bumped by ⌫ in the table: opens the first confirmation action (Delete). */
  confirmRequest: number;
}

/**
 * The selection bar (`web-activity-selected`): it takes the place of the type chips, the summary
 * and the export button while entries are selected. It draws every action in `BULK_ACTIONS`, so it
 * never names one: a pick action opens its menu under its button (`web-activity-bulk-category`,
 * `web-activity-bulk-account`), a confirm action asks first (`web-activity-bulk-delete`), and a run
 * action applies at once. Each is one save through the offline store, then the saved toast offers
 * Undo, which restores every entry in one more save (`web-activity-bulk-done`).
 */
export function SelectionBar({ selection, onClear, onDone, confirmRequest }: BarProps) {
  const writer = useLedgerWriter();
  const toast = useToast();
  const [menu, setMenu] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ConfirmAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const count = selection.entries.length;
  const currency = selection.ledger.currency;
  const totals = selectionTotals(selection.entries);
  const sums = [
    totals.expense ? (["spent", totals.expense, "expense"] as const) : null,
    totals.income ? (["in", totals.income, "income"] as const) : null,
    totals.investment ? (["invested", totals.investment, "investment"] as const) : null,
  ].filter((item) => item !== null);

  // ⌫ in the table: ask with the first confirm action that applies (Delete).
  const [seenRequest, setSeenRequest] = useState(confirmRequest);
  if (confirmRequest !== seenRequest) {
    setSeenRequest(confirmRequest);
    const action = BULK_ACTIONS.find((item): item is ConfirmAction => item.kind === "confirm" && !item.unavailable?.(selection));
    if (action && writer.save) setConfirming(action);
  }

  async function run(action: BulkAction, outcome: BulkOutcome): Promise<boolean> {
    if (!writer.save || busy) return false;
    const before = selection.entries;
    setBusy(true);
    setError(null);
    try {
      const receipt = await writer.save(outcome.change);
      const save = writer.save;
      toast.show({
        title: outcome.done,
        ...(receipt.savedOffline ? { detail: "Saved on this device. It syncs when you're back online." } : {}),
        onUndo: () => {
          void save(restoreEntries(before)).catch(() => {
            toast.show({ title: "Couldn't undo", detail: "The entries stay as they are now.", tone: "error" });
          });
        },
      });
      onDone(action, before);
      return true;
    } catch (failure) {
      setError(message(failure));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="selection-bar-wrap">
      <div className="selection-bar" role="toolbar" aria-label={`${entries(count)} selected`}>
        <button type="button" className="pick-box pick-box--mixed selection-bar__clear-box" aria-label="Clear selection" onClick={onClear}>
          <span className="pick-box__mark" aria-hidden="true" />
        </button>
        <span className="selection-bar__count" aria-live="polite">
          {count} selected
        </span>
        {sums.length ? (
          <span className="selection-bar__sum">
            {sums.map(([label, cents, tone]) => (
              <span key={label}>
                {" · "}
                {label} <Money cents={cents} currency={currency} tone={tone === "expense" ? "expense" : tone} className="selection-bar__money" />
              </span>
            ))}
          </span>
        ) : null}
        <span className="selection-bar__space" />
        {BULK_ACTIONS.map((action) => {
          const reason = action.unavailable?.(selection) ?? (writer.save ? null : writer.unavailable);
          if (action.kind === "pick") {
            return (
              <PickMenu
                key={action.id}
                action={action}
                selection={selection}
                open={menu === action.id}
                disabledReason={reason}
                busy={busy}
                onOpen={(open) => {
                  setError(null);
                  setMenu(open ? action.id : null);
                }}
                onPick={(optionId) => {
                  void run(action, action.apply(selection, optionId)).then((ok) => {
                    if (ok) setMenu(null);
                  });
                }}
              />
            );
          }
          return (
            <Button
              key={action.id}
              className={cx("selection-bar__action", action.danger && "selection-bar__action--danger")}
              icon={action.icon}
              aria-disabled={reason ? true : undefined}
              title={reason ?? undefined}
              busy={busy}
              onClick={() => {
                if (reason) return;
                setError(null);
                setMenu(null);
                if (action.kind === "confirm") setConfirming(action);
                else void run(action, action.apply(selection));
              }}
            >
              {action.label}
            </Button>
          );
        })}
        <span className="selection-bar__divider" aria-hidden="true" />
        <Button variant="quiet" className="selection-bar__clear" shortcut="Esc" onClick={onClear}>
          Clear
        </Button>
      </div>
      {error ? (
        <p className="selection-bar__error" role="alert">
          <Icon name="alert-circle" size={16} />
          {error}
        </p>
      ) : null}
      {confirming ? (
        <ConfirmSelection
          action={confirming}
          selection={selection}
          busy={busy}
          error={error}
          onCancel={() => {
            setConfirming(null);
            setError(null);
          }}
          onConfirm={() => {
            void run(confirming, confirming.apply(selection)).then((ok) => {
              if (ok) setConfirming(null);
            });
          }}
        />
      ) : null}
    </div>
  );
}

/** A pick action's button and its menu: a title, an optional search, the options and a note. */
function PickMenu({
  action,
  selection,
  open,
  disabledReason,
  busy,
  onOpen,
  onPick,
}: {
  action: PickAction;
  selection: Selection;
  open: boolean;
  disabledReason: string | null;
  busy: boolean;
  onOpen: (open: boolean) => void;
  onPick: (optionId: string) => void;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <span className="bulk-menu-anchor">
      <Button
        ref={triggerRef}
        className={cx("selection-bar__action", open && "selection-bar__action--open")}
        icon={action.icon}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-disabled={disabledReason ? true : undefined}
        title={disabledReason ?? undefined}
        onClick={() => {
          if (!disabledReason) onOpen(!open);
        }}
      >
        {action.label}
      </Button>
      {open ? <MenuPanel id={id} action={action} selection={selection} busy={busy} triggerRef={triggerRef} onOpen={onOpen} onPick={onPick} /> : null}
    </span>
  );
}

/** The open menu. It mounts on open, so its search starts empty each time. */
function MenuPanel({
  id,
  action,
  selection,
  busy,
  triggerRef,
  onOpen,
  onPick,
}: {
  id: string;
  action: PickAction;
  selection: Selection;
  busy: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onOpen: (open: boolean) => void;
  onPick: (optionId: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const options = action.options(selection).filter((option) => !needle || option.label.toLowerCase().includes(needle));
  const total = selection.entries.length;
  const note = action.note?.(selection);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>("input, .bulk-menu__option")?.focus();
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) onOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
    };
  }, [onOpen, triggerRef]);

  function close() {
    onOpen(false);
    triggerRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const all = [...(panelRef.current?.querySelectorAll<HTMLElement>(".bulk-menu__option") ?? [])];
    if (all.length === 0) return;
    event.preventDefault();
    const index = all.indexOf(document.activeElement as HTMLElement);
    const next = index < 0 ? (event.key === "ArrowDown" ? 0 : all.length - 1) : Math.min(all.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)));
    all[next]?.focus();
  }

  return (
        <div ref={panelRef} id={id} className="bulk-menu" role="dialog" aria-labelledby={`${id}-title`} aria-busy={busy || undefined} onKeyDown={onKeyDown}>
          <h2 id={`${id}-title`} className="bulk-menu__title">
            {action.title(selection)}
          </h2>
          {action.search ? (
            <label className="bulk-menu__search">
              <Icon name="search" size={14} />
              <span className="visually-hidden">{action.search}</span>
              <input
                type="search"
                value={filter}
                placeholder={action.search}
                onChange={(event) => {
                  setFilter(event.target.value);
                }}
              />
            </label>
          ) : null}
          <ul className="bulk-menu__list">
            {options.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  className="bulk-menu__option"
                  aria-label={option.count ? `${option.label}, ${String(option.count)} of ${String(total)} already` : option.label}
                  onClick={() => {
                    if (!busy) onPick(option.id);
                  }}
                >
                  {option.category ? (
                    <span className="category-dot bulk-menu__tile" style={tileStyle({ ...option.category, entryKind: option.category.kind })}>
                      <Icon name={option.icon} size={14} />
                    </span>
                  ) : (
                    <span className="bulk-menu__tile bulk-menu__tile--plain">
                      <Icon name={option.icon} size={15} />
                    </span>
                  )}
                  <span className="bulk-menu__label">{option.label}</span>
                  {option.count ? (
                    <span className="bulk-menu__count" aria-hidden="true">
                      {option.count} of {total}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
            {options.length === 0 ? <li className="bulk-menu__empty">Nothing matches “{filter.trim()}”.</li> : null}
          </ul>
          {note ? (
            <p className="bulk-menu__note">
              <Icon name="repeat" size={14} />
              {note}
            </p>
          ) : null}
        </div>
  );
}

/** A confirm action's dialog: what happens, the entries (five, then "and N more"), a note and the action. */
function ConfirmSelection({ action, selection, busy, error, onCancel, onConfirm }: { action: ConfirmAction; selection: Selection; busy: boolean; error: string | null; onCancel: () => void; onConfirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const { ledger } = selection;
  const shown = selection.entries.slice(0, LISTED);
  const more = selection.entries.length - shown.length;
  const note = action.note?.(selection);
  return (
    <Dialog
      title={action.title(selection)}
      onClose={onCancel}
      initialFocus={cancelRef}
      className="bulk-confirm"
      icon={
        <span className="bulk-confirm__icon" aria-hidden="true">
          <Icon name={action.icon} size={18} />
        </span>
      }
      actions={
        <>
          <Button ref={cancelRef} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={action.danger ? "danger" : "primary"} busy={busy} onClick={onConfirm}>
            {action.confirmLabel(selection)}
          </Button>
        </>
      }
    >
      <p className="bulk-confirm__lead">{action.description}</p>
      <ul className="bulk-confirm__list">
        {shown.map((entry) => {
          const category = ledger.categories.find((item) => item.id === entry.categoryId);
          return (
            <li key={entry.id} style={tileStyle({ ...category, entryKind: entry.kind })}>
              <span className="category-dot bulk-confirm__tile">
                <Icon name={categoryIcon(category?.icon)} size={14} />
              </span>
              <span className="bulk-confirm__title">{entry.title}</span>
              <time className="bulk-confirm__date" dateTime={entry.date}>
                {shortDay(entry.date)}
              </time>
              <Money {...rowAmount(entry.kind, entry.share)} currency={ledger.currency} tone={TONE[entry.kind]} className="bulk-confirm__amount" />
            </li>
          );
        })}
        {more > 0 ? <li className="bulk-confirm__more">and {more} more</li> : null}
      </ul>
      {note ? (
        <p className="bulk-confirm__note">
          <Icon name="repeat" size={15} />
          {note}
        </p>
      ) : null}
      {error ? <SaveErrorBanner message={error} /> : null}
    </Dialog>
  );
}
