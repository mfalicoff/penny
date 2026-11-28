import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ApiError } from "../../api/client";
import { purchaseInboxPagesQuery } from "../../api/purchaseInbox";
import { discardInboxItem, finishInboxItem, receiptInboxPagesQuery, receiptInboxQuery, refreshInbox, type InboxFilter } from "../../api/receiptInbox";
import type { ReceiptInboxFile, ReceiptInboxItem } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";
import { Badge, Button, ChoiceGroup } from "../../design/controls";
import { Icon, TrayIcon } from "../../design/Icon";
import { Dialog } from "../../design/ModalDialog";
import { Banner, EmptyState, ErrorState, LoadingState, useOnline, useToast } from "../../design/states";
import { useIsDemo } from "../../demo/demo";
import { AddEntryDialog } from "../entries/AddEntryDialog";
import { useLedgerWriter } from "../entries/writer";
import { ReceiptPreviewDialog } from "../receipts/ReceiptPreviewDialog";
import { AttachSheet, NOT_VERIFIED_WARNING } from "./AttachSheet";
import {
  asReceipt,
  attachedCount,
  dayText,
  discardMessage,
  expiryNote,
  fileDetail,
  fileLabel,
  filesCount,
  newExpenseSeed,
  OFFLINE_HINT,
  openFiles,
  orderedFiles,
  preselectFile,
  receivedDay,
  senderName,
} from "./model";
import { whenText } from "../purchaseInbox/model";
import { PurchaseSection } from "../purchaseInbox/PurchaseSection";
import { useAttachingReceipts, useInboxStatus, useInboxSyncRefresh } from "./useInbox";

export interface InboxSearch {
  status: "to_review" | "done";
  item?: string | undefined;
}

type Open = { id: string; view: "detail" | "attach" | "new" | "discard" | "done"; file?: ReceiptInboxFile } | null;

const receiptFilter = (status: InboxSearch["status"]): InboxFilter => (status === "to_review" ? "to_attach" : "attached");

/**
 * The Inbox (cards `web-inbox-captured`, `web-inbox-captured-empty`; MAZ-184 and MAZ-291): captured
 * purchases (Purchases) and emailed receipts waiting to be attached (Emailed receipts), with a To
 * review / Done filter in the URL. Receipt rows are buttons: Enter opens one, Delete offers Discard.
 * Sender, subject, merchant and file names are shown as plain text. Nothing is ever added or
 * attached without the person choosing it.
 */
export function InboxPage({ search }: { search: InboxSearch }) {
  const email = useAccountEmail();
  const navigate = useNavigate();
  const status = useInboxStatus();
  const online = useOnline();
  const demo = useIsDemo();
  const writer = useLedgerWriter();
  const list = useInfiniteQuery({ ...receiptInboxPagesQuery(email, receiptFilter(search.status)), enabled: status.enabled });
  const purchaseList = useInfiniteQuery({ ...purchaseInboxPagesQuery(email, search.status), enabled: !demo });
  // Receipts waiting to be attached, for "Matches a receipt" (the Done tab shows attached ones).
  const waiting = useQuery({ ...receiptInboxQuery(email, "to_attach"), enabled: status.enabled });
  const items = status.enabled ? (list.data?.pages.flatMap((page) => page.items) ?? []) : [];
  const purchases = purchaseList.data?.pages.flatMap((page) => page.items) ?? [];
  const attaching = useAttachingReceipts();
  const [open, setOpen] = useState<Open>(search.item ? { id: search.item, view: "detail" } : null);
  const listRef = useRef<HTMLUListElement>(null);
  // Where focus goes back to when a sheet closes: the row, or the next one if the item left the list.
  const focusAfter = useRef<{ id: string; index: number } | null>(null);
  useInboxSyncRefresh(status.enabled);

  const ids = items.map((item) => item.id).join(",");
  useEffect(() => {
    const target = focusAfter.current;
    if (!target || open) return;
    const active = document.activeElement;
    if (active && active !== document.body) {
      // Still on its row (it may leave once the list refreshes), or the person moved on.
      if (!listRef.current?.contains(active)) focusAfter.current = null;
      return;
    }
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-inbox-row]") ?? [])];
    const row = rows.find((element) => element.dataset.inboxRow === target.id) ?? rows[Math.min(target.index, rows.length - 1)];
    if (row) {
      row.focus();
      focusAfter.current = null;
    }
  }, [ids, open]);

  const current = open ? items.find((item) => item.id === open.id) : undefined;
  const close = () => {
    if (open) focusAfter.current = { id: open.id, index: Math.max(0, items.findIndex((item) => item.id === open.id)) };
    setOpen(null);
    if (search.item) void navigate({ to: "/receipts", search: { status: search.status }, replace: true });
  };

  // A server from before contract 2.5.0 has no captured purchases (404): the Inbox shows receipts only.
  const purchasesMissing = purchaseList.error instanceof ApiError && purchaseList.error.status === 404;
  const receiptsLoading = status.enabled && list.isPending;
  const loading = !status.loaded || receiptsLoading || (!demo && purchaseList.isPending && purchaseList.fetchStatus !== "idle");
  const failed = (list.isError && !list.data) || (purchaseList.isError && !purchaseList.data && !purchasesMissing);
  const empty = !loading && !failed && items.length === 0 && purchases.length === 0;
  const retry = () => {
    void list.refetch();
    void purchaseList.refetch();
  };
  const failedError = list.error ?? purchaseList.error;

  return (
    <div className="inbox">
      <div className="inbox__bar">
        <ChoiceGroup<InboxSearch["status"]>
          legend="Show"
          hideLegend
          name="inbox-filter"
          value={search.status}
          onChange={(value) => void navigate({ to: "/receipts", search: { status: value } })}
          options={[
            { value: "to_review", label: "To review" },
            { value: "done", label: "Done" },
          ]}
        />
      </div>
      {!online ? (
        <p className="note" role="status">
          <Icon name="cloud-offline" size={14} /> {OFFLINE_HINT}
        </p>
      ) : null}
      {search.status === "done" && !empty ? <p className="note">Handled in the last 30 days. Receipts stay on their entries.</p> : null}
      {loading && !failed ? <LoadingState label="Loading your Inbox…" /> : null}
      {failed ? (
        <ErrorState title="Penny couldn't load your Inbox" onRetry={retry} retrying={list.isFetching || purchaseList.isFetching}>
          {failedError instanceof ApiError && failedError.status === 0 ? "Penny can't reach the server." : "Nothing was changed. Try again in a moment."}
        </ErrorState>
      ) : null}
      {empty ? (
        search.status === "to_review" ? (
          <div className="inbox-panel inbox-empty">
            <EmptyState
              glyph={<TrayIcon size={44} weight={28} />}
              title="Nothing to review"
              action={
                status.enabled ? (
                  <Link to="/settings/receipt-email" className="wbtn">
                    Your receipt email address
                  </Link>
                ) : undefined
              }
            >
              <p>{status.enabled ? "Purchases captured with Apple Pay on your iPhone and receipts you email to Penny wait here until you add them." : "Purchases captured with Apple Pay on your iPhone wait here until you add them."}</p>
            </EmptyState>
          </div>
        ) : (
          <div className="inbox-panel inbox-empty">
            <EmptyState glyph={<TrayIcon size={44} weight={28} />} title="Nothing handled lately">
              <p>Purchases and receipts you handle show here for 30 days.</p>
            </EmptyState>
          </div>
        )
      ) : null}
      <PurchaseSection
        items={purchases}
        done={search.status === "done"}
        receipts={waiting.data?.items ?? []}
        writer={writer}
        online={online}
        hasMore={purchaseList.hasNextPage}
        loadingMore={purchaseList.isFetchingNextPage}
        onMore={() => void purchaseList.fetchNextPage()}
      />
      {items.length ? (
        <section className="inbox-section" aria-labelledby="inbox-receipts">
          <div className="inbox-section__head">
            <h2 id="inbox-receipts" className="inbox-section__title">
              Emailed receipts
            </h2>
          </div>
          <ul ref={listRef} className="inbox-list inbox-panel" aria-label={search.status === "to_review" ? "Receipts to attach" : "Attached receipts"}>
            {items.map((item) => (
              <InboxRow
                key={item.id}
                item={item}
                attaching={item.files.some((file) => !file.linked && attaching.has(file.receiptId))}
                onOpen={() => {
                  setOpen({ id: item.id, view: "detail" });
                }}
                onDiscard={() => {
                  if (online) setOpen({ id: item.id, view: "discard" });
                }}
              />
            ))}
          </ul>
          {list.hasNextPage ? (
            <Button busy={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
              {list.isFetchingNextPage ? "Loading…" : "Show older"}
            </Button>
          ) : null}
        </section>
      ) : null}

      {open && !current && list.data ? (
        <Dialog title="Receipt not found" description="This email isn't in your inbox any more. It may have been discarded, attached or deleted after 30 days." onClose={close} actions={<Button onClick={close}>Close</Button>} />
      ) : null}
      {open && current && open.view === "detail" ? (
        <ItemDialog
          item={current}
          online={online}
          attaching={attaching}
          onClose={close}
          onAttach={(file) => {
            setOpen({ id: current.id, view: "attach", ...(file ? { file } : {}) });
          }}
          onNewExpense={() => {
            setOpen({ id: current.id, view: "new" });
          }}
          onDiscard={() => {
            setOpen({ id: current.id, view: "discard" });
          }}
          onDone={() => {
            setOpen({ id: current.id, view: "done" });
          }}
        />
      ) : null}
      {open && current && open.view === "attach" ? <AttachSheet item={current} {...(open.file ? { file: open.file } : {})} onClose={close} onDone={() => undefined} /> : null}
      {open && current && open.view === "new" ? <NewExpense item={current} onClose={close} /> : null}
      {open && current && (open.view === "discard" || open.view === "done") ? <DiscardDialog item={current} done={open.view === "done"} onClose={close} /> : null}
    </div>
  );
}

/** "Today, 8:06 AM" or "Nov 6", as the Inbox card dates its emailed receipts. */
function receivedText(receivedAt: number, day: string): string {
  const when = whenText(receivedAt);
  return when.startsWith("Today") || when.startsWith("Yesterday") ? when : dayText(day);
}

function InboxRow({ item, attaching, onOpen, onDiscard }: { item: ReceiptInboxItem; attaching: boolean; onOpen: () => void; onDiscard: () => void }) {
  const sender = senderName(item.from);
  const day = receivedDay(item.receivedAt);
  const expiry = expiryNote(item);
  const state = attaching ? "Attaching…" : item.status === "partly_attached" ? attachedCount(item) : null;
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onDiscard();
    }
  }
  return (
    <li className="inbox-row">
      <button type="button" className="inbox-row__main" data-inbox-row={item.id} aria-keyshortcuts="Delete" onClick={onOpen} onKeyDown={onKeyDown}>
        <span className="inbox-row__icon" aria-hidden="true">
          <Icon name="receipt" size={18} />
        </span>
        <span className="inbox-row__sender">{sender}</span>
        <span className="inbox-row__date">
          <time dateTime={day}>{receivedText(item.receivedAt, day)}</time>
        </span>
        <span className="inbox-row__subject">
          {item.subject || "(no subject)"} · {filesCount(item.files.length)}
        </span>
        {state || expiry || !item.senderVerified ? (
          <span className="inbox-row__meta">
            {[state, expiry].filter(Boolean).join(" · ")}
            {item.senderVerified ? null : (
              <>
                {" "}
                <Badge tone="pending" icon="alert-circle">
                  Sender not verified
                </Badge>
              </>
            )}
          </span>
        ) : null}
      </button>
    </li>
  );
}

function ItemDialog({
  item,
  online,
  attaching,
  onClose,
  onAttach,
  onNewExpense,
  onDiscard,
  onDone,
}: {
  item: ReceiptInboxItem;
  online: boolean;
  attaching: ReadonlySet<string>;
  onClose: () => void;
  onAttach: (file?: ReceiptInboxFile) => void;
  onNewExpense: () => void;
  onDiscard: () => void;
  onDone: () => void;
}) {
  const writer = useLedgerWriter();
  const [preview, setPreview] = useState<ReceiptInboxFile | null>(null);
  const files = orderedFiles(item);
  const remaining = openFiles(item).length;
  const day = receivedDay(item.receivedAt);
  const expiry = expiryNote(item);
  const offline = online ? {} : { busy: true, "aria-describedby": "inbox-offline-hint" };
  const onEntry = (receiptId: string) => writer.ledger?.transactions.find((entry) => entry.receipt?.id === receiptId);
  return (
    <>
      <Dialog
        title={senderName(item.from)}
        description={item.subject || "(no subject)"}
        onClose={onClose}
        wide
        actions={
          <>
            <Button variant="danger-quiet" icon="trash" {...offline} onClick={onDiscard}>
              Discard
            </Button>
            {item.status === "partly_attached" ? (
              <Button {...offline} onClick={onDone}>
                Done
              </Button>
            ) : null}
            {remaining > 0 ? (
              <>
                <Button {...offline} onClick={onNewExpense}>
                  New expense
                </Button>
                <Button
                  variant="primary"
                  {...offline}
                  onClick={() => {
                    onAttach();
                  }}
                >
                  Attach to…
                </Button>
              </>
            ) : null}
          </>
        }
      >
        <p className="inbox-item__meta">
          Received <time dateTime={day}>{dayText(day)}</time>
          {item.status === "partly_attached" ? ` · ${attachedCount(item)}` : item.status === "attached" ? " · Attached" : ""}
          {expiry ? ` · ${expiry}` : ""}
        </p>
        {!item.senderVerified ? (
          <p className="inbox-warning">
            <Icon name="alert-circle" size={16} />
            <span>
              <b>Sender not verified.</b> {NOT_VERIFIED_WARNING}
            </span>
          </p>
        ) : null}
        {!online ? (
          <p id="inbox-offline-hint" className="note" role="status">
            <Icon name="cloud-offline" size={14} /> {OFFLINE_HINT}
          </p>
        ) : null}
        <ul className="inbox-files-list" aria-label="Files">
          {files.map((file) => {
            const entry = file.linked ? onEntry(file.receiptId) : undefined;
            const pending = !file.linked && attaching.has(file.receiptId);
            return (
              <li key={file.receiptId} className="receipt-att">
                <span className="receipt-att__thumb" aria-hidden="true">
                  <Icon name={file.kind === "email" ? "receipt" : file.mime === "application/pdf" ? "document-text" : "image"} size={22} />
                </span>
                <span className="receipt-att__text">
                  <b>{fileLabel(file)}</b>
                  <span>
                    {fileDetail(file)}
                    {file.linked ? (entry ? ` · Attached to ${entry.title}` : " · Attached") : pending ? " · Attaching…" : ""}
                  </span>
                </span>
                <Button
                  variant="quiet"
                  aria-label={`Open ${fileLabel(file)}`}
                  onClick={() => {
                    setPreview(file);
                  }}
                >
                  Open
                </Button>
                {!file.linked && remaining > 1 ? (
                  <Button
                    {...offline}
                    aria-label={`Attach ${fileLabel(file)} to an expense`}
                    onClick={() => {
                      onAttach(file);
                    }}
                  >
                    Attach
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Dialog>
      {preview ? (
        <ReceiptPreviewDialog
          receipt={asReceipt(preview)}
          onClose={() => {
            setPreview(null);
          }}
        />
      ) : null}
    </>
  );
}

/** Add entry as an expense with the receipt attached: the received day, the sender's name, no amount. */
function NewExpense({ item, onClose }: { item: ReceiptInboxItem; onClose: () => void }) {
  const file = preselectFile(item);
  if (!file) return null;
  return <AddEntryDialog seed={newExpenseSeed(item, file)} onClose={onClose} />;
}

function DiscardDialog({ item, done, onClose }: { item: ReceiptInboxItem; done: boolean; onClose: () => void }) {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const toast = useToast();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const { title, detail } = discardMessage(item);
  const remove = useMutation({
    mutationKey: ["receipt-inbox", done ? "done" : "discard"],
    mutationFn: () => (done ? finishInboxItem(item.id) : discardInboxItem(item.id)),
    onSuccess: async (result) => {
      await refreshInbox(queryClient, email);
      onClose();
      const deleted = result.deleted === 1 ? "1 file deleted" : `${String(result.deleted)} files deleted`;
      toast.show({ title: done ? "Moved to Attached" : "Email discarded", detail: result.kept ? `${deleted}, ${String(result.kept)} kept on entries.` : `${deleted}.` });
    },
  });
  const failure =
    remove.error instanceof ApiError && remove.error.status === 404
      ? "This email is no longer in your inbox."
      : remove.error instanceof ApiError && remove.error.status === 0
        ? "Penny can't reach the server, so nothing was deleted."
        : remove.isError
          ? "Nothing was deleted. Try again in a moment."
          : null;
  return (
    <Dialog
      title={done ? "Finish this email?" : title}
      description={done ? `Done discards the files you haven't attached. ${detail}` : detail}
      onClose={onClose}
      initialFocus={cancelRef}
      actions={
        <>
          <Button ref={cancelRef} variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" busy={remove.isPending} onClick={() => { remove.mutate(); }}>
            {done ? "Done" : "Discard"}
          </Button>
        </>
      }
    >
      {failure ? (
        <Banner tone="error" title={done ? "Not finished" : "Not discarded"}>
          {failure}
        </Banner>
      ) : null}
    </Dialog>
  );
}
