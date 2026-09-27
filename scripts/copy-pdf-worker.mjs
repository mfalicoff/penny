import { mkdirSync, copyFileSync, cpSync } from "node:fs";
mkdirSync("public/pdf", { recursive: true });
copyFileSync(
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  "public/pdf/pdf.worker.min.mjs",
);
cpSync("node_modules/pdfjs-dist/standard_fonts", "public/pdf/standard_fonts", {
  recursive: true,
});
cpSync("node_modules/pdfjs-dist/wasm", "public/pdf/wasm", { recursive: true });
