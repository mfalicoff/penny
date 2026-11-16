import { useEffect, useRef, useState } from "react";
import { fetchReceipt } from "../../api/receipts";
import { Icon } from "../../design/Icon";
import { openPdf } from "../receipts/pdf";

const WIDTH = 72;

/**
 * A small picture of a receipt's first page (MAZ-184, "always look before attaching"): the bytes
 * are fetched with the session like the full viewer, a photo shown from a `blob:` URL and a PDF's
 * first page painted by pdf.js. It is decorative: the file's name and kind next to it carry the
 * meaning, and the full viewer is one press away. Any failure falls back to the file icon.
 */
export function ReceiptThumb({ uri, mime }: { uri: string; mime: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<{ kind: "icon" } | { kind: "image"; url: string } | { kind: "pdf" }>({ kind: "icon" });

  useEffect(() => {
    const controller = new AbortController();
    let url: string | null = null;
    let destroy: (() => Promise<void>) | null = null;
    void (async () => {
      try {
        const blob = await fetchReceipt({ uri, mime }, controller.signal);
        if (controller.signal.aborted) return;
        if (blob.type === "application/pdf") {
          const pdf = await openPdf(new Uint8Array(await blob.arrayBuffer()), controller.signal);
          destroy = () => pdf.destroy();
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the thumbnail can unmount while the PDF opens.
          if (controller.signal.aborted || !canvasRef.current) return;
          setState({ kind: "pdf" });
          await pdf.render(1, canvasRef.current, WIDTH, controller.signal);
        } else if (blob.type.startsWith("image/")) {
          url = URL.createObjectURL(blob);
          setState({ kind: "image", url });
        }
      } catch {
        if (!controller.signal.aborted) setState({ kind: "icon" });
      }
    })();
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
      if (destroy) void destroy();
    };
  }, [uri, mime]);

  return (
    <span className="inbox-thumb" aria-hidden="true">
      {state.kind === "image" ? <img src={state.url} alt="" decoding="async" onError={() => { setState({ kind: "icon" }); }} /> : null}
      <canvas ref={canvasRef} hidden={state.kind !== "pdf"} />
      {state.kind === "icon" ? <Icon name={mime === "application/pdf" ? "document-text" : "image"} size={24} /> : null}
    </span>
  );
}
