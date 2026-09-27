import { z } from "zod";

export const receiptUploadSchema = z.object({
  name: z.string().min(1).max(255),
  mime: z.enum([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/heic",
    "image/heif",
  ]),
  base64: z
    .string()
    .max(14 * 1024 * 1024)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});

export function decodeReceipt(input: z.infer<typeof receiptUploadSchema>) {
  const bytes = Buffer.from(input.base64, "base64");
  const mime = input.mime;
  const header = bytes.subarray(0, 12);
  const signatureValid =
    mime === "application/pdf"
      ? header.toString().startsWith("%PDF-")
      : mime === "image/jpeg"
        ? header[0] === 255 && header[1] === 216 && header[2] === 255
        : mime === "image/png"
          ? header
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : mime === "image/gif"
            ? /^GIF8[79]a/.test(header.toString())
            : mime === "image/webp"
              ? header.subarray(0, 4).toString() === "RIFF" &&
              header.subarray(8, 12).toString() === "WEBP"
              : header.subarray(4, 8).toString() === "ftyp";
  if (!bytes.length || bytes.length > 10 * 1024 * 1024 || !signatureValid) {
    return undefined;
  }
  return bytes;
}
