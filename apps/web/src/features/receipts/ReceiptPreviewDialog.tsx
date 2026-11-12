import type { Receipt } from "@domain/ledger.ts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import { fetchReceipt, RECEIPT_READ_MESSAGES, receiptKind, saveBlob } from "../../api/receipts";
import { expireSession } from "../../auth/lifecycle";
import { Button } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { Dialog } from "../../design/ModalDialog";
import { Banner, LoadingState } from "../../design/states";
import "../../design/receipts.css";
import { openPdf, PdfUnreadableError, type PdfPreview } from "./pdf";

type View =
  | { status: "loading" }
  | { status: "image"; blob: Blob; url: string }
  | { status: "pdf"; blob: Blob; pdf: PdfPreview }
  | { status: "error"; title: string; message: string; blob?: Blob; retry?: boolean };

const PDF = "application/pdf";

/** Widest page we paint; wider dialogs center it. */
const MAX_PAGE_WIDTH = 860;

/**
 * Receipt preview (specimen `receipt`, MAZ-94): the bytes are fetched with the session, then shown
 * locally, an `<img>` from a blob URL for photos and pdf.js pages on a canvas for PDFs, with page
 * controls and Download. A damaged file, a photo the browser can't decode (HEIC outside Safari),
 * a receipt that isn't yours to read and an offline server each say so and keep Download when
 * the bytes arrived. Closing aborts the request, stops the PDF worker and revokes the blob URL;
 * focus returns to the control that opened it.
 */
export function ReceiptPreviewDialog({ receipt, onClose }: { receipt: Receipt; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const { uri, mime } = receipt;

  useEffect(() => {
    const controller = new AbortController();
    let url: string | null = null;
    let pdf: PdfPreview | null = null;
    const show = (next: View) => {
      if (!controller.signal.aborted) setView(next);
    };
    show({ status: "loading" });
    void (async () => {
      let blob: Blob;
      try {
        blob = await fetchReceipt({ uri, mime }, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) void expireSession(queryClient);
        const message = error instanceof Error ? error.message : RECEIPT_READ_MESSAGES.failed;
        const missing = error instanceof ApiError && (error.status === 404 || error.status === 403);
        show({ status: "error", title: missing ? "Receipt not available" : "Couldn't load the receipt", message, retry: !missing });
        return;
      }
      if (blob.type === PDF) {
        try {
          pdf = await openPdf(new Uint8Array(await blob.arrayBuffer()), controller.signal);
          if (controller.signal.aborted) {
            void pdf.destroy();
            return;
          }
          show({ status: "pdf", blob, pdf });
        } catch (error) {
          if (controller.signal.aborted) return;
          show({
            status: "error",
            title: "This PDF can't be shown",
            message: error instanceof PdfUnreadableError ? "Penny couldn't read it. The file may be damaged. You can still download it." : "Penny couldn't open the PDF viewer. Download the file to view it.",
            blob,
          });
        }
        return;
      }
      url = URL.createObjectURL(blob);
      show({ status: "image", blob, url });
    })();
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
      if (pdf) void pdf.destroy();
    };
  }, [uri, mime, attempt, queryClient]);

  const blob = view.status === "loading" ? undefined : view.blob;
  return (
    <Dialog
      title={receipt.name || "Receipt"}
      description={blob ? receiptKind(blob.type) : receipt.mime ? receiptKind(receipt.mime) : "Receipt"}
      onClose={onClose}
      wide
      actions={
        blob ? (
          <Button
            variant="secondary"
            icon="arrow-down"
            onClick={() => {
              saveBlob(blob, receipt.name || "receipt");
            }}
          >
            Download
          </Button>
        ) : undefined
      }
    >
      <div className="receipt-preview">
        {view.status === "loading" ? <LoadingState label="Loading the receipt…" /> : null}
        {view.status === "image" ? (
          <ImagePreview
            url={view.url}
            name={receipt.name}
            onUndecodable={() => {
              setView({ status: "error", title: "This photo can't be shown here", message: "This browser can't display this photo format. Download it to view it.", blob: view.blob });
            }}
          />
        ) : null}
        {view.status === "pdf" ? <PdfPages pdf={view.pdf} name={receipt.name} /> : null}
        {view.status === "error" ? (
          <Banner
            tone="error"
            title={view.title}
            action={
              view.retry ? (
                <Button
                  onClick={() => {
                    setAttempt((value) => value + 1);
                  }}
                >
                  Try again
                </Button>
              ) : undefined
            }
          >
            {view.message}
          </Banner>
        ) : null}
      </div>
    </Dialog>
  );
}

function ImagePreview({ url, name, onUndecodable }: { url: string; name: string; onUndecodable: () => void }) {
  return (
    <div className="receipt-preview__frame">
      <img className="receipt-preview__image" src={url} alt={`Receipt photo: ${name}`} onError={onUndecodable} decoding="async" />
    </div>
  );
}

function PdfPages({ pdf, name }: { pdf: PdfPreview; name: string }) {
  const [page, setPage] = useState(1);
  const [failed, setFailed] = useState(false);
  const [rendered, setRendered] = useState(0);
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => {
      setWidth(Math.max(200, Math.min(MAX_PAGE_WIDTH, Math.floor(frame.clientWidth))));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const controller = new AbortController();
    pdf.render(page, canvas, width, controller.signal).then(
      () => {
        if (!controller.signal.aborted) setRendered(page);
      },
      (error: unknown) => {
        if (!controller.signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) setFailed(true);
      },
    );
    return () => {
      controller.abort();
    };
  }, [pdf, page, width]);

  const count = pdf.pageCount;
  return (
    <div className="receipt-preview__pdf">
      {failed ? (
        <Banner tone="error" title="This page can't be shown">
          Penny couldn't draw page {page}. The file may be damaged. You can still download it.
        </Banner>
      ) : null}
      <div ref={frameRef} className="receipt-preview__frame">
        <canvas ref={canvasRef} className="receipt-preview__page" role="img" aria-label={`Page ${String(page)} of ${String(count)}, ${name}`} data-rendered-page={rendered || undefined} />
      </div>
      {count > 1 ? (
        <nav className="receipt-preview__pages" aria-label="PDF pages">
          <Button
            icon="chevron-back"
            // busy (aria-disabled) rather than disabled, so focus stays on the button at either end.
            busy={page <= 1}
            onClick={() => {
              if (page <= 1) return;
              setFailed(false);
              setPage((value) => Math.max(1, value - 1));
            }}
          >
            Previous page
          </Button>
          <span role="status" className="pk-num">
            Page {page} of {count}
          </span>
          <Button
            busy={page >= count}
            onClick={() => {
              if (page >= count) return;
              setFailed(false);
              setPage((value) => Math.min(count, value + 1));
            }}
          >
            Next page
            <Icon name="chevron-forward" size={16} weight={44} />
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
