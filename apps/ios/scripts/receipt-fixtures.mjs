#!/usr/bin/env node
// Synthetic receipt files for the native receipt UI tests (MAZ-78, docs/ios-receipts.md), built
// byte by byte so nothing personal or copyrighted is committed. The shapes match the browser's
// apps/web/e2e/fixtures/receipts.ts. `scripts/ios.sh ui-test` writes them to
// .cache/ios/receipt-fixtures/ and seeds each UI test simulator with them: the photo into the
// photo library (simctl addmedia) and the files into Files › On My iPhone/iPad.
//
//   node apps/ios/scripts/receipt-fixtures.mjs <output directory>
//
// Writes the files and manifest.json ({name: {sha256, bytes}}), which the UI tests compare
// with what the server stored.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

/** A minimal, valid PDF 1.4 with `pages` pages, each saying "Penny test receipt" and its number. */
function syntheticPdf(pages = 2) {
  const objects = [];
  const pageIds = Array.from({ length: pages }, (_, index) => 4 + index * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pageIds.forEach((id, index) => {
    const text = `0.89 0.47 0.31 rg 30 60 240 180 re f BT /F1 18 Tf 0 0 0 rg 30 340 Td (Penny test receipt) Tj 0 -28 Td (Page ${index + 1} of ${pages}) Tj ET`;
    objects[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`;
    objects[id + 1] = `<< /Length ${text.length} >>\nstream\n${text}\nendstream`;
  });
  let body = "%PDF-1.4\n";
  const offsets = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = body.length;
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) body += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** A `width`×`height` RGB PNG: a copper-to-green gradient with darker "receipt lines". */
function syntheticPng(width = 360, height = 540) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = [];
  for (let y = 0; y < height; y++) {
    rows.push(0);
    const line = y > 60 && y % 40 < 8;
    for (let x = 0; x < width; x++) {
      const shade = line && x > 40 && x < width - 40 ? 0.45 : 1;
      rows.push(Math.round((240 - (x / width) * 110) * shade), Math.round((200 + (y / height) * 40) * shade), Math.round(170 * shade));
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from(rows))), chunk("IEND", Buffer.alloc(0))]);
}

const output = process.argv[2];
if (!output) {
  console.error("usage: receipt-fixtures.mjs <output directory>");
  process.exit(2);
}
mkdirSync(output, { recursive: true });

const png = syntheticPng();
const files = {
  // Photo library.
  "penny-receipt-photo.png": png,
  // Files › On My iPhone/iPad.
  "penny-receipt.pdf": syntheticPdf(2),
  "penny-damaged.pdf": Buffer.concat([Buffer.from("%PDF-1.7\n", "latin1"), Buffer.alloc(512, 0x7a)]),
  "penny-renamed.pdf": png,
  "penny-oversized.png": Buffer.concat([png.subarray(0, 8), Buffer.alloc(10 * 1024 * 1024 + 1 - 8)]),
};
const manifest = {};
for (const [name, bytes] of Object.entries(files)) {
  writeFileSync(join(output, name), bytes);
  manifest[name] = { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
}
writeFileSync(join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Receipt fixtures: ${output}`);
