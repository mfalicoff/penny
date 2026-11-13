import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";

// Synthetic receipt files for the browser tests (MAZ-94), built byte by byte so nothing personal
// or copyrighted is committed: a valid two-page PDF (Helvetica text and a filled box per page), a
// small PNG, a file that starts like a PDF but is damaged, and files the rules refuse.

/** A minimal, valid PDF 1.4 with `pages` pages, each saying "Penny test receipt" and its number. */
export function syntheticPdf(pages = 2): Buffer {
  const objects: string[] = [];
  const pageIds = Array.from({ length: pages }, (_, index) => 4 + index * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${String(id)} 0 R`).join(" ")}] /Count ${String(pages)} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pageIds.forEach((id, index) => {
    const text = `0.89 0.47 0.31 rg 30 60 240 180 re f BT /F1 18 Tf 0 0 0 rg 30 340 Td (Penny test receipt) Tj 0 -28 Td (Page ${String(index + 1)} of ${String(pages)}) Tj ET`;
    objects[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 3 0 R >> >> /Contents ${String(id + 1)} 0 R >>`;
    objects[id + 1] = `<< /Length ${String(text.length)} >>\nstream\n${text}\nendstream`;
  });
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = body.length;
    body += `${String(id)} 0 obj\n${objects[id] ?? ""}\nendobj\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${String(objects.length)}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) body += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${String(objects.length)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** A `width`×`height` RGB PNG with a copper-to-green gradient. */
export function syntheticPng(width = 48, height = 32): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows: number[] = [];
  for (let y = 0; y < height; y++) {
    rows.push(0);
    for (let x = 0; x < width; x++) rows.push(Math.round(228 - (x / width) * 120), Math.round(120 + (y / height) * 36), 80);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from(rows))), chunk("IEND", Buffer.alloc(0))]);
}

/** Starts with the PDF signature, so the server accepts it, but pdf.js can't read anything after. */
export const damagedPdf = (): Buffer => Buffer.concat([Buffer.from("%PDF-1.7\n", "latin1"), Buffer.alloc(512, 0x7a)]);

/** A PNG signature followed by padding, one byte over the 10 MiB limit. */
export const oversizedPng = (): Buffer => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(10 * 1024 * 1024 - 7)]);

export const sha256 = (bytes: Buffer | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
