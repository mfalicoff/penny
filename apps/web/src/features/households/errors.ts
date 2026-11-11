import { ApiError } from "../../api/client";

export type SharedErrorKind = "offline" | "unreachable" | "conflict" | "membership" | "rate" | "invalid" | "other";

export interface SharedError {
  kind: SharedErrorKind;
  message: string;
}

/**
 * Turns a failed shared write into what the person should know and do next. Shared data is
 * online-only, so a network failure says that the draft is kept and to try again online; a 404
 * from a household that was readable a moment ago means membership changed (left, removed or
 * archived elsewhere); 409s are the server's own conflict or restriction text.
 */
export function describeSharedError(error: unknown): SharedError {
  if (error instanceof ApiError) {
    if (error.status === 0) {
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      return offline
        ? { kind: "offline", message: "You're offline. Shared households need a connection, so nothing was sent." }
        : { kind: "unreachable", message: "Penny can't reach the server, so nothing was sent." };
    }
    if (error.status === 404 && /household not found/i.test(error.message)) {
      return { kind: "membership", message: "You're no longer a member of this household, or it was archived. Nothing was changed." };
    }
    if (error.status === 409) return { kind: "conflict", message: error.message };
    if (error.status === 429) return { kind: "rate", message: "Too many attempts. Wait a few minutes and try again." };
    if (error.status >= 500) return { kind: "other", message: "The server had a problem, so nothing was saved. Try again in a moment." };
    return { kind: "invalid", message: error.message };
  }
  return { kind: "other", message: "Something went wrong, so nothing was saved." };
}

/** A read that failed: what to say on the page. */
export function describeLoadError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return navigator.onLine ? "Penny can't reach the server." : "You're offline. Shared households need a connection.";
    if (error.status === 404) return "This household isn't available to you. You may have left it, or it was archived.";
  }
  return "Nothing was changed. Try again in a moment.";
}
