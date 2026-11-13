import { describe, expect, it, vi } from "vitest";

/**
 * The pdf.js wrapper (MAZ-94) with pdf.js replaced: a render replaced while its page is still
 * loading must never paint the shared canvas, or pdf.js refuses the next render on it.
 */

const fake = vi.hoisted(() => {
  let releasePage: (() => void) | null = null;
  const render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 140 * scale }), render, cleanup: vi.fn() };
  return {
    render,
    page,
    hold() {
      return new Promise<typeof page>((resolve) => {
        releasePage = () => {
          resolve(page);
        };
      });
    },
    release() {
      releasePage?.();
    },
  };
});

vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "/assets/pdf.worker.min.js" }));
vi.mock("pdfjs-dist", () => {
  const document = { numPages: 2, getPage: vi.fn(() => fake.hold()) };
  return {
    GlobalWorkerOptions: { workerSrc: "" },
    VerbosityLevel: { ERRORS: 0 },
    AnnotationMode: { ENABLE: 1 },
    RenderingCancelledException: class extends Error {},
    getDocument: () => ({ promise: Promise.resolve(document), destroy: () => Promise.resolve() }),
  };
});

describe("openPdf", () => {
  it("drops a render that was replaced while its page loaded, without touching the canvas", async () => {
    const { openPdf } = await import("../src/features/receipts/pdf");
    const pdf = await openPdf(new Uint8Array([1]), new AbortController().signal);
    const canvas = document.createElement("canvas");
    const controller = new AbortController();
    const rendering = pdf.render(1, canvas, 200, controller.signal);
    controller.abort();
    fake.release();
    await expect(rendering).rejects.toMatchObject({ name: "AbortError" });
    expect(fake.render).not.toHaveBeenCalled();
    expect(canvas.width).toBe(300);
    expect(fake.page.cleanup).toHaveBeenCalled();
  });
});
