import type { Receipt } from "@domain/ledger.ts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { checkReceiptFile, formatBytes, isServedReceipt, RECEIPT_ACCEPT, RECEIPT_MESSAGES, ReceiptFileError, receiptKind, uploadReceipt } from "../../api/receipts";
import { expireSession } from "../../auth/lifecycle";
import { Button, cx } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { useOnline } from "../../design/states";
import "../../design/receipts.css";
import { ReceiptPreviewDialog } from "./ReceiptPreviewDialog";

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; file: File; progress: number | null }
  | { kind: "failed"; file: File | null; message: string };

const IMAGE_ACCEPT = RECEIPT_ACCEPT.split(",")
  .filter((type) => type.startsWith("image/") || (type.startsWith(".") && type !== ".pdf"))
  .join(",");

interface ReceiptFieldProps {
  /** The linked receipt, or null for none. */
  value: Receipt | null;
  onChange: (receipt: Receipt | null) => void;
  /** Reports whether an upload is in progress, so the form can hold Save until it ends. */
  onBusyChange?: (busy: boolean) => void;
  /** Shown under the controls, e.g. who can see the receipt. */
  hint?: ReactNode;
}

/**
 * Receipt attach, upload and preview inside a form (specimens `entry-extras`, `receipt-upload`;
 * web `add-entry` drop zone). Choose a photo or a file, or drop one: it is checked against the
 * server's rules, uploaded with progress and a Cancel, and on success linked to the form's draft,
 * which keeps it until Save, Discard or sign-out. A failed upload keeps the file for Try again.
 * Removing only unlinks: the file stays on the server, which has no receipt delete.
 */
export function ReceiptField({ value, onChange, onBusyChange, hint }: ReceiptFieldProps) {
  const queryClient = useQueryClient();
  const online = useOnline();
  const ids = { label: useId(), hint: useId(), status: useId() };
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [announcement, setAnnouncement] = useState("");
  const [preview, setPreview] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Sizes of files uploaded here; a receipt loaded with the entry has no size in its link.
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const controllerRef = useRef<AbortController | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(onBusyChange);
  useEffect(() => {
    busyRef.current = onBusyChange;
  }, [onBusyChange]);

  const uploading = phase.kind === "uploading";
  useEffect(() => {
    busyRef.current?.(uploading);
  }, [uploading]);

  // Leaving the form (Keep draft, Escape, a page change) cancels an upload still in flight.
  useEffect(
    () => () => {
      controllerRef.current?.abort();
      busyRef.current?.(false);
    },
    [],
  );

  // Back to Photo after an upload ends, a cancel, a dismissed error or a removal, unless the
  // person has moved on to another field meanwhile.
  const focusAttach = () => {
    setTimeout(() => {
      const active = document.activeElement;
      if (!active || active === document.body || rootRef.current?.contains(active)) attachRef.current?.focus();
    }, 0);
  };

  async function start(file: File) {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setAnnouncement("");
    setPhase({ kind: "uploading", file, progress: null });
    try {
      const mime = await checkReceiptFile(file);
      const receipt = await uploadReceipt(file, mime, {
        signal: controller.signal,
        onProgress: (fraction) => {
          if (!controller.signal.aborted) setPhase({ kind: "uploading", file, progress: fraction });
        },
      });
      if (controller.signal.aborted) return;
      setSizes((previous) => ({ ...previous, [receipt.id]: file.size }));
      onChange(receipt);
      setPhase({ kind: "idle" });
      setAnnouncement(`${receipt.name} attached. It's saved with the entry when you press Save.`);
      focusAttach();
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
      if (error instanceof ApiError && error.status === 401) void expireSession(queryClient);
      const message = error instanceof ReceiptFileError || error instanceof ApiError ? error.message : RECEIPT_MESSAGES.failed;
      // A file the rules refuse can't succeed on retry; a network or server failure can.
      const retryable = !(error instanceof ReceiptFileError) && !(error instanceof ApiError && error.isClientError);
      setPhase({ kind: "failed", file: retryable ? file : null, message });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }

  function cancel() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setPhase({ kind: "idle" });
    setAnnouncement("Upload cancelled. Nothing was attached.");
    focusAttach();
  }

  function dismiss() {
    setPhase({ kind: "idle" });
    focusAttach();
  }

  function picked(files: FileList | null, input: HTMLInputElement | null) {
    const file = files?.[0];
    // Clear the input so choosing the same file again (after a failure) still fires.
    if (input) input.value = "";
    if (file) void start(file);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (!online || uploading) return;
    picked(event.dataTransfer.files, null);
  }

  const served = value ? isServedReceipt(value) : false;
  const disabled = !online || uploading;
  const size = value ? sizes[value.id] : undefined;
  const replacing = value !== null;

  return (
    <div ref={rootRef} className="receipt-field" role="group" aria-labelledby={ids.label} aria-describedby={ids.hint}>
      <div id={ids.label} className="receipt-field__label">
        Receipt
      </div>
      {value ? (
        <div className="receipt-att">
          <span className="receipt-att__thumb" aria-hidden="true">
            <Icon name={value.mime === "application/pdf" ? "document-text" : value.mime ? "image" : "receipt"} size={22} />
          </span>
          <span className="receipt-att__text">
            <b>{value.name || "Receipt"}</b>
            <span>
              {value.mime ? receiptKind(value.mime) : "Attached"}
              {size !== undefined ? ` · ${formatBytes(size)}` : ""}
            </span>
          </span>
          {served ? (
            <Button
              variant="quiet"
              onClick={() => {
                setPreview(true);
              }}
              aria-label={`Preview ${value.name || "receipt"}`}
            >
              Preview
            </Button>
          ) : null}
          <Button
            variant="danger-quiet"
            icon="close"
            iconOnly
            aria-label={`Remove ${value.name || "receipt"}`}
            onClick={() => {
              onChange(null);
              setAnnouncement("Receipt removed. Save to keep the entry without it.");
              focusAttach();
            }}
          />
        </div>
      ) : null}

      {phase.kind === "uploading" ? (
        <div className="receipt-progress">
          <span className="receipt-att__thumb" aria-hidden="true">
            <Icon name="arrow-up" size={20} />
          </span>
          <span className="receipt-progress__body">
            <span className="receipt-progress__name">
              Uploading {phase.file.name}
              <span className="note"> · {formatBytes(phase.file.size)}</span>
            </span>
            <progress
              className="receipt-progress__bar"
              aria-label={`Uploading ${phase.file.name}`}
              max={1}
              {...(phase.progress === null ? {} : { value: phase.progress })}
            />
          </span>
          <Button variant="quiet" onClick={cancel}>
            Cancel upload
          </Button>
        </div>
      ) : null}

      {phase.kind === "failed" ? (
        <div className="receipt-error" role="alert">
          <Icon name="alert-circle" size={20} />
          <div className="receipt-error__body">
            <b>Couldn't attach the receipt</b>
            <span>
              {phase.message} {value ? "The receipt already attached is kept." : "Your entry is kept."}
            </span>
          </div>
          <span className="receipt-error__actions">
            {phase.file ? (
              <Button
                disabled={!online}
                onClick={() => {
                  if (phase.file) void start(phase.file);
                }}
              >
                Try again
              </Button>
            ) : null}
            <Button variant="quiet" onClick={dismiss}>
              Dismiss
            </Button>
          </span>
        </div>
      ) : null}

      <div
        className={cx("receipt-drop", dragging && "receipt-drop--over", disabled && "receipt-drop--off")}
        onDragOver={(event) => {
          if (disabled) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDragging(true);
        }}
        onDragLeave={() => {
          setDragging(false);
        }}
        onDrop={onDrop}
      >
        <span className="receipt-drop__hint" aria-hidden="true">
          <Icon name="receipt" size={16} />
          {replacing ? "Drop a file to replace it, or" : "Drop a receipt here, or"}
        </span>
        <span className="receipt-drop__buttons">
          <Button
            ref={attachRef}
            icon="image"
            busy={disabled}
            onClick={() => photoInputRef.current?.click()}
            aria-label={replacing ? "Replace with a photo" : "Attach a photo"}
          >
            Photo
          </Button>
          <Button
            icon="document-text"
            busy={disabled}
            onClick={() => fileInputRef.current?.click()}
            aria-label={replacing ? "Replace with a file or PDF" : "Attach a file or PDF"}
          >
            File or PDF
          </Button>
        </span>
        <input
          ref={photoInputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          hidden
          tabIndex={-1}
          aria-label="Receipt photo"
          onChange={(event) => {
            picked(event.currentTarget.files, event.currentTarget);
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept={RECEIPT_ACCEPT}
          hidden
          tabIndex={-1}
          aria-label="Receipt file"
          onChange={(event) => {
            picked(event.currentTarget.files, event.currentTarget);
          }}
        />
      </div>
      <p id={ids.hint} className="note">
        {online ? "Photos (JPEG, PNG, WebP, GIF, HEIC) or PDFs up to 10 MB." : "Connect to the internet to attach a receipt. The rest of the entry saves offline."}
        {value && !served ? " This receipt was added in the Penny app and opens there." : null}
        {hint ? <> {hint}</> : null}
      </p>
      <p id={ids.status} className="visually-hidden" role="status">
        {announcement}
      </p>
      {preview && value ? (
        <ReceiptPreviewDialog
          receipt={value}
          onClose={() => {
            setPreview(false);
          }}
        />
      ) : null}
    </div>
  );
}
