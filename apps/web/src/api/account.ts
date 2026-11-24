import { ApiError, apiFetch } from "./client";
import { okSchema } from "./schemas";

/**
 * The whole account (MAZ-152): deleting it, the full export (one ZIP the server prepares) and the
 * entries CSV (a month, a year or everything). Downloads go through `fetch`, so the page can say
 * when the file is ready and how large it is, and a failure shows as an error instead of a broken
 * download.
 */

export const ACCOUNT_MESSAGES = {
  wrongPassword: "Your password is incorrect.",
  enterPassword: "Enter your password to delete your account.",
  offline: "Penny can't reach the server. Check your connection, then try again.",
  exportFailed: "The file didn't download. Try again.",
} as const;

/** `POST /api/account/delete`. A password account sends its password; a provider account sends none. */
export async function deleteAccount(password: string | undefined, signal?: AbortSignal): Promise<void> {
  await apiFetch("/api/account/delete", okSchema, { method: "POST", body: password === undefined ? {} : { password }, ...(signal ? { signal } : {}) });
}

/** A month, a year, or everything (`null` or `{}`, as the projection takes it). */
export type EntriesPeriod = { month: string } | { year: string } | Record<string, never> | null;

export function entriesPath(period: EntriesPeriod): `/api/${string}` {
  if (period && "month" in period) return `/api/export/entries?month=${encodeURIComponent(period.month)}`;
  if (period && "year" in period) return `/api/export/entries?year=${encodeURIComponent(period.year)}`;
  return "/api/export/entries";
}

export interface DownloadedFile {
  name: string;
  size: number;
}

/** "14.2 MB", "820 KB", "512 bytes". */
export function fileSize(bytes: number): string {
  if (bytes < 1000) return `${String(bytes)} bytes`;
  if (bytes < 1_000_000) return `${String(Math.round(bytes / 1000))} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** The file name from `Content-Disposition` (RFC 6266/8187), else `fallback`. */
export function attachmentName(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const extended = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (extended) {
    try {
      return decodeURIComponent(extended);
    } catch {
      return fallback;
    }
  }
  return /filename="?([^";]+)"?/i.exec(header)?.[1] ?? fallback;
}

/** Downloads `path` and hands the file to the browser to save. */
export async function download(path: `/api/${string}`, fallbackName: string, signal?: AbortSignal): Promise<DownloadedFile> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", headers: { Accept: "application/zip, text/csv, application/json" }, signal: signal ?? null });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError(0, ACCOUNT_MESSAGES.offline, { cause });
  }
  if (!response.ok) {
    let message: string | undefined;
    try {
      const body: unknown = await response.json();
      if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") message = body.error;
    } catch {
      message = undefined;
    }
    throw new ApiError(response.status, message ?? ACCOUNT_MESSAGES.exportFailed);
  }
  const blob = await response.blob();
  const name = attachmentName(response.headers.get("Content-Disposition"), fallbackName);
  saveBlob(blob, name);
  return { name, size: blob.size };
}

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the save before the URL goes.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
}
