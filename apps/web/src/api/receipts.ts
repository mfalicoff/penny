import type { Receipt } from "@domain/ledger.ts";
import { ApiError, currentTransport } from "./client";
import { receiptSchema } from "./schemas";

/**
 * Receipt files (MAZ-94) over `POST /api/receipts` and `GET /api/receipts/{id}`. The server's
 * rules (docs/migration/receipts.md) are checked here first so a bad file fails before any
 * upload: the same seven types, 1 byte to 10 MiB, and the file signature for the type. The
 * server stays the authority and checks them all again.
 */

export const RECEIPT_MIMES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"] as const;
export type ReceiptMime = (typeof RECEIPT_MIMES)[number];

/** The decoded size limit, 10 MiB: `ReceiptFormat.MaxBytes`. */
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const MAX_NAME_LENGTH = 255;

/** For the file input's `accept`: the types, plus extensions for HEIC/HEIF files browsers don't type. */
export const RECEIPT_ACCEPT = [...RECEIPT_MIMES, ".pdf", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"].join(",");

const BY_EXTENSION: Record<string, ReceiptMime> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
};

export const isReceiptMime = (value: string): value is ReceiptMime => (RECEIPT_MIMES as readonly string[]).includes(value);

/** What the person sees for a type: "PDF" or "Photo". */
export const receiptKind = (mime: string) => (mime === "application/pdf" ? "PDF" : "Photo");

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const RECEIPT_MESSAGES = {
  empty: "This file is empty. Choose a photo or PDF.",
  tooLarge: "This file is larger than 10 MB. Choose a smaller photo or PDF.",
  unsupported: "Penny can attach photos (JPEG, PNG, WebP, GIF, HEIC) and PDFs. Choose one of those.",
  mismatch: "This file isn't a valid photo or PDF. It may be damaged or renamed. Choose another file.",
  unreadable: "Penny couldn't read this file. Choose it again.",
  offline: "Penny can't reach the server. Check your connection, then try again.",
  failed: "The upload didn't finish. Try again.",
  expired: "Your session ended. Sign in again to attach a receipt.",
  requestTooLarge: "This file is too large to upload. Choose one under 10 MB.",
} as const;

/** A file that can't be attached, with the reason in words. */
export class ReceiptFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptFileError";
  }
}

function startsWith(bytes: Uint8Array, prefix: readonly number[], offset = 0) {
  return prefix.every((value, index) => bytes[offset + index] === value);
}
const ascii = (text: string) => Array.from({ length: text.length }, (_, index) => text.charCodeAt(index));

/** `ReceiptFormat.IsAcceptable`'s signature check, over the first 12 bytes. */
export function matchesSignature(mime: ReceiptMime, header: Uint8Array): boolean {
  switch (mime) {
    case "application/pdf":
      return startsWith(header, ascii("%PDF-"));
    case "image/jpeg":
      return startsWith(header, [0xff, 0xd8, 0xff]);
    case "image/png":
      return startsWith(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/gif":
      return startsWith(header, ascii("GIF87a")) || startsWith(header, ascii("GIF89a"));
    case "image/webp":
      return header.length >= 12 && startsWith(header, ascii("RIFF")) && startsWith(header, ascii("WEBP"), 8);
    case "image/heic":
    case "image/heif":
      return header.length >= 8 && startsWith(header, ascii("ftyp"), 4);
  }
}

/** The receipt type of `file`: its browser type, or its extension when the browser leaves it blank or generic. */
export function receiptMimeOf(file: Pick<File, "name" | "type">): ReceiptMime | null {
  if (isReceiptMime(file.type)) return file.type;
  if (file.type && file.type !== "application/octet-stream" && !file.type.startsWith("image/")) return null;
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  return extension ? (BY_EXTENSION[extension] ?? null) : null;
}

/** Shortens a long name to the server's 255 characters, keeping the extension. */
export function receiptName(name: string): string {
  const trimmed = name.trim() || "receipt";
  if (trimmed.length <= MAX_NAME_LENGTH) return trimmed;
  const extension = /\.[a-z0-9]{1,8}$/i.exec(trimmed)?.[0] ?? "";
  return trimmed.slice(0, MAX_NAME_LENGTH - extension.length) + extension;
}

async function readHeader(file: Blob): Promise<Uint8Array> {
  try {
    return new Uint8Array(await file.slice(0, 12).arrayBuffer());
  } catch {
    throw new ReceiptFileError(RECEIPT_MESSAGES.unreadable);
  }
}

/** Checks `file` the way the server will. Throws `ReceiptFileError` with the reason. */
export async function checkReceiptFile(file: File): Promise<ReceiptMime> {
  const mime = receiptMimeOf(file);
  if (!mime) throw new ReceiptFileError(RECEIPT_MESSAGES.unsupported);
  if (file.size === 0) throw new ReceiptFileError(RECEIPT_MESSAGES.empty);
  if (file.size > MAX_RECEIPT_BYTES) throw new ReceiptFileError(RECEIPT_MESSAGES.tooLarge);
  if (!matchesSignature(mime, await readHeader(file))) throw new ReceiptFileError(RECEIPT_MESSAGES.mismatch);
  return mime;
}

const abortError = () => new DOMException("The upload was cancelled.", "AbortError");

/** The file as base64 (the API's JSON body), without loading it into a string twice. */
function readBase64(file: Blob, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const reader = new FileReader();
    const onAbort = () => {
      reader.abort();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    reader.onload = () => {
      signal.removeEventListener("abort", onAbort);
      const url = typeof reader.result === "string" ? reader.result : "";
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new ReceiptFileError(RECEIPT_MESSAGES.unreadable));
    };
    reader.onabort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    reader.readAsDataURL(file);
  });
}

const errorText = (text: string): string | undefined => {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && "error" in value && typeof value.error === "string" ? value.error : undefined;
  } catch {
    return undefined;
  }
};

/** An upload failure in words. 401 keeps its status so the caller can end the session. */
function uploadError(status: number, text: string): ApiError {
  if (status === 401) return new ApiError(401, RECEIPT_MESSAGES.expired);
  if (status === 413) return new ApiError(413, RECEIPT_MESSAGES.requestTooLarge);
  if (status === 400) return new ApiError(400, errorText(text) ?? RECEIPT_MESSAGES.unsupported);
  if (status === 0) return new ApiError(0, RECEIPT_MESSAGES.offline);
  return new ApiError(status, RECEIPT_MESSAGES.failed);
}

function parseReceipt(status: number, text: string): Receipt {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = undefined;
  }
  const parsed = receiptSchema.safeParse(value);
  if (!parsed.success) throw new ApiError(status, RECEIPT_MESSAGES.failed, { cause: parsed.error });
  return parsed.data;
}

/** `POST /api/receipts` with upload progress (fetch has none), cancelled through `signal`. */
function post(body: string, signal: AbortSignal, onProgress: (fraction: number) => void): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const onAbort = () => {
      request.abort();
    };
    const done = () => {
      signal.removeEventListener("abort", onAbort);
    };
    request.open("POST", "/api/receipts");
    request.setRequestHeader("Content-Type", "application/json");
    request.setRequestHeader("Accept", "application/json");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      done();
      resolve({ status: request.status, text: request.responseText });
    };
    request.onerror = () => {
      done();
      resolve({ status: 0, text: "" });
    };
    request.ontimeout = request.onerror;
    request.onabort = () => {
      done();
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    request.send(body);
  });
}

export interface UploadOptions {
  signal: AbortSignal;
  /** Fraction of the request body sent, 0 to 1. */
  onProgress?: (fraction: number) => void;
}

/**
 * Uploads a checked file and returns the receipt to link. Throws `ApiError` (401 for an ended
 * session) or an `AbortError` when `signal` aborts, at any stage.
 */
export async function uploadReceipt(file: File, mime: ReceiptMime, { signal, onProgress = () => undefined }: UploadOptions): Promise<Receipt> {
  const base64 = await readBase64(file, signal);
  const payload = { name: receiptName(file.name), mime, base64 };
  const transport = currentTransport();
  if (transport) {
    const response = await transport("/api/receipts", { method: "POST", body: payload, signal });
    const text = await response.text();
    if (!response.ok) throw uploadError(response.status, text);
    onProgress(1);
    return parseReceipt(response.status, text);
  }
  onProgress(0);
  const { status, text } = await post(JSON.stringify(payload), signal, onProgress);
  if (status < 200 || status >= 300) throw uploadError(status, text);
  return parseReceipt(status, text);
}

/** Receipt links that this server serves; anything else (a legacy native path) can't be opened here. */
export const isServedReceipt = (receipt: Pick<Receipt, "uri">) => /^\/api\/receipts\/[^/?#]+$/.test(receipt.uri);

export const RECEIPT_READ_MESSAGES = {
  notFound: "This receipt isn't available. It may have been removed, or you no longer have access to it.",
  expired: "Your session ended. Sign in again to see this receipt.",
  offline: "Penny can't reach the server, so the receipt can't be shown. Try again when you're online.",
  failed: "Penny couldn't load this receipt. Try again.",
} as const;

/** The receipt's bytes, with the session. Throws `ApiError` (401, 404, …) or an `AbortError`. */
export async function fetchReceipt(receipt: Pick<Receipt, "uri" | "mime">, signal: AbortSignal): Promise<Blob> {
  if (!isServedReceipt(receipt)) throw new ApiError(404, RECEIPT_READ_MESSAGES.notFound);
  const path = receipt.uri as `/api/${string}`;
  const transport = currentTransport();
  let response: Response;
  try {
    response = transport
      ? await transport(path, { method: "GET", body: undefined, signal })
      : await fetch(path, { credentials: "same-origin", signal, headers: { Accept: `${receipt.mime}, application/json` } });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError(0, RECEIPT_READ_MESSAGES.offline, { cause });
  }
  if (!response.ok) {
    const status = response.status;
    await response.body?.cancel().catch(() => undefined);
    throw new ApiError(
      status,
      status === 401 ? RECEIPT_READ_MESSAGES.expired : status === 403 || status === 404 ? RECEIPT_READ_MESSAGES.notFound : RECEIPT_READ_MESSAGES.failed,
    );
  }
  const blob = await response.blob();
  // The stored type is authoritative. A repeating shared expense knows only the id, so the
  // server's Content-Type (its stored type) names it then.
  const type = receipt.mime || (response.headers.get("Content-Type") ?? "").split(";")[0]?.trim() || blob.type;
  return blob.type === type ? blob : new Blob([blob], { type });
}

/** Saves `blob` as a download named `name`, then releases its object URL. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  link.hidden = true;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Firefox reads the URL after the click returns.
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }
}
