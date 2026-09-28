import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Button, C, s } from "../../shared/ui";
GlobalWorkerOptions.workerSrc = "/pdf/pdf.worker.min.mjs";
export function PdfPreview({
  source,
  name,
}: {
  source: string;
  name: string;
  onError: (message: string) => void;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let canceled = false;
    const task = getDocument({
      url: source,
      standardFontDataUrl: "/pdf/standard_fonts/",
      wasmUrl: "/pdf/wasm/",
    });
    task.promise
      .then((doc) => {
        if (!canceled) setPdf(doc);
      })
      .catch(() => {
        if (!canceled) {
          setError(
            "This PDF cannot be previewed. You can still download the original.",
          );
          setBusy(false);
        }
      });
    return () => {
      canceled = true;
      void task.destroy();
    };
  }, [source]);
  useEffect(() => {
    if (!pdf) return;
    let canceled = false;
    let render: RenderTask | undefined;
    pdf
      .getPage(page)
      .then(async (documentPage) => {
        if (canceled || !canvas.current) return;
        const natural = documentPage.getViewport({ scale: 1 });
        const viewport = documentPage.getViewport({
          scale: Math.min(2, 1200 / natural.width, 1800 / natural.height),
        });
        canvas.current.width = viewport.width;
        canvas.current.height = viewport.height;
        render = documentPage.render({ canvas: canvas.current, viewport });
        await render.promise;
        if (!canceled) setBusy(false);
      })
      .catch(() => {
        if (!canceled) {
          setError("Could not preview this page. Download the original below.");
          setBusy(false);
        }
      });
    return () => {
      canceled = true;
      render?.cancel();
    };
  }, [pdf, page]);
  return (
    <View style={{ gap: 16 }}>
      {error ? (
        <Text style={s.error}>{error}</Text>
      ) : (
        <>
          {busy && <Text style={s.muted}>Rendering receipt…</Text>}
          {React.createElement("canvas", {
            ref: canvas,
            role: "img",
            "aria-label": `${name}, page ${page}`,
            style: {
              width: "100%",
              maxWidth: 640,
              height: "auto",
              alignSelf: "center",
              border: `1px solid ${C.line}`,
              borderRadius: 8,
              display: pdf ? "block" : "none",
            },
          })}
        </>
      )}
      {pdf && pdf.numPages > 1 && (
        <View style={s.between}>
          <Button
            title="Previous page"
            tone="quiet"
            disabled={busy || page === 1}
            onPress={() => { setBusy(true); setPage(page - 1); }}
          />
          <Text style={s.muted}>
            {page} / {pdf.numPages}
          </Text>
          <Button
            title="Next page"
            tone="quiet"
            disabled={busy || page === pdf.numPages}
            onPress={() => { setBusy(true); setPage(page + 1); }}
          />
        </View>
      )}
      {React.createElement(
        "a",
        {
          href: source,
          download: name,
          style: { color: C.accent, fontSize: 13, fontFamily: "system-ui" },
        },
        "Download original PDF",
      )}
    </View>
  );
}
