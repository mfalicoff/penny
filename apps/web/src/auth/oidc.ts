import { z } from "zod";
import { completeOidc, startOidc } from "../api/auth";

/**
 * Browser OpenID Connect sign-in. The API does all the protocol work (state, nonce, PKCE,
 * token exchange); the browser only opens the provider and hands the callback URL back.
 *
 * Popup flow (default): the sign-in page opens a popup on click, asks the API to start an
 * attempt, and points the popup at the provider. The provider returns to
 * `/auth/callback` inside the popup, which sends its URL to the opener over a same-origin
 * BroadcastChannel and closes. The opener then posts it to `/api/auth/oidc/complete`.
 * A channel (not `window.opener`) is used because providers that send a
 * Cross-Origin-Opener-Policy header sever the opener link.
 *
 * Redirect fallback: when the browser blocks the popup, the same attempt runs in the
 * current tab. The transaction id waits in sessionStorage across the provider round trip.
 */

export const CALLBACK_PATH = "/auth/callback";
const CHANNEL_NAME = "penny-oidc";
const POPUP_NAME = "penny-oidc";
const STORAGE_KEY = "penny.oidc.attempt";
const CLOSE_POLL_MS = 400;
const ACK_WAIT_MS = 500;

export type OidcFailure = "blocked" | "no-attempt" | "expired";

export class OidcError extends Error {
  readonly code: OidcFailure;
  constructor(code: OidcFailure, message: string) {
    super(message);
    this.name = "OidcError";
    this.code = code;
  }
}

const channelMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("callback"), url: z.string().max(8192) }),
  z.object({ type: z.literal("ack"), state: z.string() }),
]);

export const oidcRedirectUri = () => `${window.location.origin}${CALLBACK_PATH}`;

/** A callback is only forwarded when it really is this app's callback address. */
function isOwnCallback(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === window.location.origin && parsed.pathname === CALLBACK_PATH && parsed.hash === "";
  } catch {
    return false;
  }
}

export interface PopupOptions {
  signal?: AbortSignal;
  /**
   * Called (once) when the popup reports itself closed. That is only a hint: providers that
   * send Cross-Origin-Opener-Policy make `popup.closed` read true while the user is still
   * signing in, so it never ends the attempt. The UI tells the user and leaves cancelling to them.
   */
  onPopupClosed?: () => void;
}

type Outcome = { kind: "callback"; url: string } | { kind: "cancelled" } | { kind: "expired" };

const expiredError = () => new OidcError("expired", "Sign-in took too long and expired. Please try again.");

/**
 * Runs the popup flow. Resolves with the signed-in email, or `null` when the user cancelled
 * (aborted the signal) before the provider returned.
 * Throws `OidcError("blocked")` when the browser refuses the popup, `OidcError("expired")`
 * when the attempt's `expiresAt` passes first, and `ApiError` for server failures
 * (state mismatch, expired attempt, unverified email, ...).
 * Once the callback has arrived the sign-in is completed and can no longer be cancelled, so the
 * UI never reports a failure for a session the server already created.
 */
export async function signInWithPopup(options: PopupOptions = {}): Promise<{ email: string } | null> {
  const { signal, onPopupClosed } = options;
  // Must run synchronously inside the click handler or browsers block the window.
  const popup = window.open("about:blank", POPUP_NAME, "popup=yes,width=520,height=720");
  if (!popup) throw new OidcError("blocked", "Your browser blocked the sign-in window.");

  const channel = new BroadcastChannel(CHANNEL_NAME);
  let resolveOutcome: (outcome: Outcome) => void = () => undefined;
  const outcome = new Promise<Outcome>((resolve) => {
    resolveOutcome = resolve;
  });
  // Set once the provider URL is known: only a callback carrying this attempt's `state` is ours.
  let expectedState: string | null = null;
  let settled = false;
  const settle = (value: Outcome) => {
    if (settled) return;
    settled = true;
    resolveOutcome(value);
  };
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const message = channelMessageSchema.safeParse(event.data);
    if (!message.success || message.data.type !== "callback" || settled) return;
    const { url } = message.data;
    if (expectedState === null || !isOwnCallback(url) || new URL(url).searchParams.get("state") !== expectedState) return;
    channel.postMessage({ type: "ack", state: expectedState });
    settle({ kind: "callback", url });
  };

  let closedReported = false;
  const poll = setInterval(() => {
    if (popup.closed && !closedReported) {
      closedReported = true;
      onPopupClosed?.();
    }
  }, CLOSE_POLL_MS);
  const onAbort = () => {
    settle({ kind: "cancelled" });
  };
  signal?.addEventListener("abort", onAbort);
  let expiry: ReturnType<typeof setTimeout> | undefined;

  try {
    // Race the start request against cancellation, so Cancel works even if the request is slow.
    const started = await Promise.race([
      startOidc(oidcRedirectUri(), signal).catch((error: unknown) => {
        if (signal?.aborted) return { kind: "cancelled" } as const;
        throw error;
      }),
      outcome,
    ]);
    if ("kind" in started) return null;
    const challenge = started;
    if (challenge.expiresAt <= Date.now()) throw expiredError();
    expectedState = new URL(challenge.authorizationUrl).searchParams.get("state");
    expiry = setTimeout(
      () => {
        settle({ kind: "expired" });
      },
      Math.max(0, challenge.expiresAt - Date.now()),
    );
    if (!popup.closed) popup.location.href = challenge.authorizationUrl;
    const result = await outcome;
    if (result.kind === "cancelled") return null;
    if (result.kind === "expired") throw expiredError();
    // Deliberately not abortable: the server may already be creating the session.
    return await completeOidc(challenge.transaction, result.url);
  } finally {
    settled = true;
    if (!popup.closed) popup.close();
    clearInterval(poll);
    if (expiry !== undefined) clearTimeout(expiry);
    signal?.removeEventListener("abort", onAbort);
    channel.close();
  }
}

/** Starts the attempt in the current tab, for browsers that block popups. */
export async function signInWithRedirect(signal?: AbortSignal): Promise<void> {
  const challenge = await startOidc(oidcRedirectUri(), signal);
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ transaction: challenge.transaction, expiresAt: challenge.expiresAt }));
  window.location.assign(challenge.authorizationUrl);
}

/**
 * Called by the callback page. Hands the URL to a waiting opener and reports whether one
 * answered. `false` means this page must finish the sign-in itself.
 */
export function deliverCallback(url: string): Promise<boolean> {
  if (typeof BroadcastChannel === "undefined") return Promise.resolve(false);
  const state = new URL(url).searchParams.get("state") ?? "";
  const channel = new BroadcastChannel(CHANNEL_NAME);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      channel.close();
      resolve(false);
    }, ACK_WAIT_MS);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const message = channelMessageSchema.safeParse(event.data);
      if (message.success && message.data.type === "ack" && message.data.state === state) {
        clearTimeout(timer);
        channel.close();
        resolve(true);
      }
    };
    channel.postMessage({ type: "callback", url });
  });
}

/** Finishes a redirect-flow sign-in on the callback page. */
export async function completeRedirectedSignIn(callbackUrl: string, signal?: AbortSignal): Promise<{ email: string }> {
  const stored = sessionStorage.getItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
  const parsed = z.object({ transaction: z.string(), expiresAt: z.number() }).safeParse(stored ? safeJson(stored) : null);
  if (!parsed.success) {
    throw new OidcError("no-attempt", "This sign-in link is no longer valid. Start again from the sign-in page.");
  }
  if (parsed.data.expiresAt <= Date.now()) throw expiredError();
  return completeOidc(parsed.data.transaction, callbackUrl, signal);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
