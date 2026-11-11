/**
 * PDF decoding for receipt previews (MAZ-94) with pdf.js (`pdfjs-dist`), loaded only when a PDF
 * is opened. The worker is a same-origin, fingerprinted file under /assets/ (Vite's `?url`), so
 * the page's Content-Security-Policy needs only `worker-src 'self'`. WebAssembly decoders are
 * off (`useWasm: false`, so no `wasm-unsafe-eval`), pdf.js logs errors only, and scripts, forms
 * and links inside a PDF never run: pages are painted to a canvas.
 */

export interface PdfPreview {
  pageCount: number;
  /** Paints page `number` (1-based) into `canvas`, `width` CSS pixels wide. */
  render(number: number, canvas: HTMLCanvasElement, width: number, signal: AbortSignal): Promise<void>;
  /** Stops the worker and frees the document. Safe to call more than once. */
  destroy(): Promise<void>;
}

/** The file isn't a PDF pdf.js can read (damaged, truncated, encrypted). */
export class PdfUnreadableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("This PDF can't be shown.", options);
    this.name = "PdfUnreadableError";
  }
}

async function library() {
  const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
  if (pdfjs.GlobalWorkerOptions.workerSrc !== worker.default) pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

export async function openPdf(data: Uint8Array, signal: AbortSignal): Promise<PdfPreview> {
  const pdfjs = await library();
  const task = pdfjs.getDocument({
    data,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
    useWasm: false,
    enableXfa: false,
  });
  const onAbort = () => void task.destroy();
  signal.addEventListener("abort", onAbort, { once: true });
  let document: Awaited<typeof task.promise>;
  try {
    document = await task.promise;
  } catch (cause) {
    await task.destroy();
    if (signal.aborted) throw new DOMException("The preview was closed.", "AbortError");
    throw new PdfUnreadableError({ cause });
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
  let destroyed = false;
  return {
    pageCount: document.numPages,
    async render(number, canvas, width, renderSignal) {
      const page = await document.getPage(number);
      try {
        // A render replaced while the page loaded must not touch the canvas: the abort listener
        // below would never fire for a signal that is already aborted.
        if (renderSignal.aborted) throw new DOMException("The page was replaced.", "AbortError");
        const unscaled = page.getViewport({ scale: 1 });
        const scale = width / unscaled.width;
        const ratio = Math.min(window.devicePixelRatio || 1, 3);
        const viewport = page.getViewport({ scale: scale * ratio });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${String(Math.floor(viewport.width / ratio))}px`;
        canvas.style.aspectRatio = `${String(viewport.width)} / ${String(viewport.height)}`;
        const job = page.render({ canvas, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE });
        const cancel = () => {
          job.cancel();
        };
        renderSignal.addEventListener("abort", cancel, { once: true });
        try {
          await job.promise;
        } catch (cause) {
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the signal can abort while the page renders.
          if (renderSignal.aborted || cause instanceof pdfjs.RenderingCancelledException) throw new DOMException("The page was replaced.", "AbortError");
          throw new PdfUnreadableError({ cause });
        } finally {
          renderSignal.removeEventListener("abort", cancel);
        }
      } finally {
        page.cleanup();
      }
    },
    async destroy() {
      if (destroyed) return;
      destroyed = true;
      await task.destroy();
    },
  };
}
