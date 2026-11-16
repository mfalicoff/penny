import type { Receipt } from "@domain/ledger.ts";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { receiptInboxQuery } from "../../api/receiptInbox";
import type { ReceiptInboxFile, ReceiptInboxItem } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";
import { Badge, Button } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { Dialog } from "../../design/ModalDialog";
import { ErrorState, LoadingState } from "../../design/states";
import { ReceiptPreviewDialog } from "../receipts/ReceiptPreviewDialog";
import { asReceipt, dayText, fileDetail, fileLabel, openFiles, receivedDay, senderName } from "./model";

/** Items in To attach that still have a file to attach. */
export const pickable = (items: readonly ReceiptInboxItem[]) => items.filter((item) => openFiles(item).length > 0);

/**
 * Entry form › Receipt › From inbox (MAZ-184): the inbox as a picker. Choosing a file links it to
 * the form like a finished upload, with no upload step; it is saved with the entry. Each file can
 * be opened in the viewer first.
 */
export function InboxPicker({ onPick, onClose }: { onPick: (receipt: Receipt) => void; onClose: () => void }) {
  const email = useAccountEmail();
  const inbox = useQuery(receiptInboxQuery(email, "to_attach"));
  const [preview, setPreview] = useState<ReceiptInboxFile | null>(null);
  const headingId = useId();
  const items = pickable(inbox.data?.items ?? []);
  return (
    <>
      <Dialog
        title="Choose a receipt from your inbox"
        description="Emailed receipts waiting to be attached. Open one to check it first."
        onClose={onClose}
        wide
        actions={
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
        }
      >
        {inbox.isPending ? <LoadingState label="Loading your receipts…" /> : null}
        {inbox.isError ? <ErrorState title="Penny couldn't load your receipts" onRetry={() => void inbox.refetch()} retrying={inbox.isFetching} /> : null}
        {inbox.data && items.length === 0 ? <p className="note">Nothing is waiting in your inbox.</p> : null}
        {items.map((item, index) => {
          const day = receivedDay(item.receivedAt);
          return (
            <section key={item.id} className="inbox-picker__item" aria-labelledby={`${headingId}-${String(index)}`}>
              <h3 id={`${headingId}-${String(index)}`} className="inbox-picker__heading">
                <span className="inbox-row__sender">{senderName(item.from)}</span>
                <span className="inbox-row__date">
                  <time dateTime={day}>{dayText(day)}</time>
                </span>
              </h3>
              <p className="inbox-row__subject">{item.subject || "(no subject)"}</p>
              {item.senderVerified ? null : (
                <Badge tone="pending" icon="alert-circle">
                  Sender not verified
                </Badge>
              )}
              <ul className="inbox-files-list" aria-label={`Files from ${senderName(item.from)}`}>
                {openFiles(item).map((file) => (
                  <li key={file.receiptId} className="receipt-att">
                    <span className="receipt-att__thumb" aria-hidden="true">
                      <Icon name={file.kind === "email" ? "receipt" : file.mime === "application/pdf" ? "document-text" : "image"} size={22} />
                    </span>
                    <span className="receipt-att__text">
                      <b>{fileLabel(file)}</b>
                      <span>{fileDetail(file)}</span>
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
                    <Button
                      variant="primary"
                      aria-label={`Use ${fileLabel(file)} from ${senderName(item.from)}`}
                      onClick={() => {
                        onPick(asReceipt(file));
                      }}
                    >
                      Use
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
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

/** Receipt ids that came by email (To attach and recently attached), to say where a removed one goes. */
export function useEmailedReceiptIds(enabled: boolean): ReadonlySet<string> {
  const email = useAccountEmail();
  const waiting = useQuery({ ...receiptInboxQuery(email, "to_attach"), enabled });
  const attached = useQuery({ ...receiptInboxQuery(email, "attached"), enabled });
  const ids = new Set<string>();
  for (const item of [...(waiting.data?.items ?? []), ...(attached.data?.items ?? [])]) for (const file of item.files) ids.add(file.receiptId);
  return ids;
}
