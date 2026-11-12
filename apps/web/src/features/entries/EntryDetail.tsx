import { deleteEntry, saveEntry } from "@domain/commands.ts";
import { accountTypeLabels, kindLabels, type Transaction } from "@domain/ledger.ts";
import { useRef, useState } from "react";
import { Badge, Button } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { Dialog } from "../../design/ModalDialog";
import { formatCents, Money } from "../../design/Money";
import { Banner, SaveErrorBanner, useToast } from "../../design/states";
import { dayLabel } from "../households/model";
import { categoryIcon, shareSummary } from "./model";
import { EntryFormDialog } from "./EntryForm";
import { ReceiptLink } from "../receipts/ReceiptLink";
import { useLedgerWriter } from "./writer";

const TONE = { expense: "expense", income: "income", investment: "investment" } as const;

/**
 * One personal entry (specimen `entry-detail`), opened from Activity. It reads the entry from this
 * browser's ledger, so a sync or another tab updates it while open. Edit opens the form over it
 * (`edit-entry`); Delete asks first (`delete-entry`), goes through the offline store and offers
 * Undo. `entry` is the row as Activity had it, used when the ledger doesn't have it (the demo).
 */
export function EntryDetailDialog({ entry: shown, onClose }: { entry: Transaction; onClose: () => void }) {
  const writer = useLedgerWriter();
  const toast = useToast();
  const [mode, setMode] = useState<"detail" | "edit" | "delete">("detail");
  const live = writer.ledger?.transactions.find((item) => item.id === shown.id);
  const entry = live ?? shown;
  const gone = writer.ledger !== null && !live;
  const currency = writer.ledger?.currency;
  const money = (value: number) => formatCents(value, currency);
  const category = writer.ledger?.categories.find((item) => item.id === entry.categoryId);
  const account = writer.ledger?.accounts.find((item) => item.id === entry.accountId);
  const trip = writer.ledger?.trips.find((item) => item.id === entry.tripId);
  const share = shareSummary(entry, money);
  const editRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <Dialog
        title={entry.title}
        onClose={onClose}
        initialFocus={editRef}
        actions={
          <>
            <Button variant="danger-quiet" icon="trash" disabled={!writer.save || gone} onClick={() => { setMode("delete"); }}>
              Delete
            </Button>
            <Button ref={editRef} variant="primary" icon="create" disabled={!writer.save || gone} onClick={() => { setMode("edit"); }}>
              Edit
            </Button>
          </>
        }
      >
        {gone ? (
          <Banner tone="info" title="This entry isn't here any more">
            It was deleted on another device or in another tab.
          </Banner>
        ) : null}
        {writer.unavailable ? <p className="note">{writer.unavailable}</p> : null}
        <div className="entry-detail">
          <span className="entry-detail__amount">
            <Money cents={entry.share} currency={currency} tone={TONE[entry.kind]} />
          </span>
          <span className="entry-detail__badges">
            <Badge>{kindLabels[entry.kind]}</Badge>
            {writer.pending.has(entry.id) ? (
              <Badge tone="pending" icon="time">
                Waiting to sync
              </Badge>
            ) : null}
            {entry.recurringId ? (
              <Badge icon="repeat">Repeating</Badge>
            ) : null}
          </span>
          {share ? <p className="note">{share}</p> : null}
        </div>
        <dl className="detail-grid">
          <dt>Date</dt>
          <dd>
            <time dateTime={entry.date}>{dayLabel(entry.date, true)}</time>
          </dd>
          <dt>Category</dt>
          <dd>
            <span className="category-dot" style={{ color: category?.color }}>
              <Icon name={categoryIcon(category?.icon)} size={16} />
            </span>{" "}
            {category?.name ?? "Unknown category"}
          </dd>
          <dt>Account</dt>
          <dd>{account ? `${account.name} · ${accountTypeLabels[account.type]}` : entry.accountId ? "Removed account" : "No account"}</dd>
          {entry.kind === "expense" ? (
            <>
              <dt>Trip</dt>
              <dd>{trip?.name ?? "No trip"}</dd>
            </>
          ) : null}
          {entry.note ? (
            <>
              <dt>Note</dt>
              <dd className="entry-detail__note">{entry.note}</dd>
            </>
          ) : null}
          {entry.receipt ? (
            <>
              <dt>Receipt</dt>
              <dd>
                <ReceiptLink receipt={entry.receipt} />
              </dd>
            </>
          ) : null}
        </dl>
      </Dialog>
      {mode === "edit" && live ? (
        <EntryFormDialog
          target={{ kind: "edit", entry: live }}
          onClose={() => {
            setMode("detail");
          }}
          onSaved={() => {
            onClose();
          }}
        />
      ) : null}
      {mode === "delete" && live ? (
        <DeleteEntryDialog
          entry={live}
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

/** Delete confirmation (specimen `delete-entry`). A stale delete shows the latest version instead of deleting it. */
function DeleteEntryDialog({ entry, onClose, onDeleted }: { entry: Transaction; onClose: () => void; onDeleted: (entry: Transaction, offline: boolean) => void }) {
  const writer = useLedgerWriter();
  const [base, setBase] = useState(entry);
  const [failure, setFailure] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
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

  return (
    <Dialog
      title={`Delete ${base.title}?`}
      description={`${money(base.total)} on ${dayLabel(base.date, true)}. It's removed from your history and totals on every device.`}
      onClose={onClose}
      initialFocus={cancelRef}
      actions={
        <>
          <Button ref={cancelRef} variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" busy={busy} onClick={() => void confirm()}>
            {busy ? "Deleting…" : stale ? "Delete anyway" : "Delete"}
          </Button>
        </>
      }
    >
      {stale ? (
        <Banner tone="error" title="This entry changed on another device">
          Nothing was deleted. It's now {base.title}, {money(base.total)} on {base.date}. Delete anyway removes this latest version.
        </Banner>
      ) : null}
      {failure ? <SaveErrorBanner message={failure} /> : null}
    </Dialog>
  );
}
