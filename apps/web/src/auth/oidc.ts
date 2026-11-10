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
/** After the popup reports closed, wait this long for a callback that may still arrive. */
const CLOSE_GRACE_MS = 750;
const CLOSE_POLL_MS = 400;
const ACK_WAIT_MS = 500;

export type OidcFailure = "blocked" | "no-attempt";

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
  z.object({ type: z.literal("ack") }),
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

/**
 * Runs the popup flow. Resolves with the signed-in email, or `null` when the user
 * closed the popup or the provider reported a cancellation before returning.
 * Throws `OidcError("blocked")` when the browser refuses the popup, and `ApiError` for
 * server failures (state mismatch, expired attempt, unverified email, ...).
 */
export async function signInWithPopup(signal?: AbortSignal): Promise<{ email: string } | null> {
  // Must run synchronously inside the click handler or browsers block the window.
  const popup = window.open("about:blank", POPUP_NAME, "popup=yes,width=520,height=720");
  if (!popup) throw new OidcError("blocked", "Your browser blocked the sign-in window.");

  const channel = new BroadcastChannel(CHANNEL_NAME);
  let finish: (url: string | null) => void = () => undefined;
  const outcome = new Promise<string | null>((resolve) => {
    finish = resolve;
  });
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const message = channelMessageSchema.safeParse(event.data);
    if (message.success && message.data.type === "callback" && isOwnCallback(message.data.url)) {
      channel.postMessage({ type: "ack" });
      finish(message.data.url);
    }
  };

  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const poll = setInterval(() => {
    if (popup.closed && closeTimer === undefined) closeTimer = setTimeout(() => {
        finish(null);
      }, CLOSE_GRACE_MS);
  }, CLOSE_POLL_MS);
  const onAbort = () => {
    finish(null);
  };
  signal?.addEventListener("abort", onAbort);

  try {
    const challenge = await startOidc(oidcRedirectUri(), signal);
    if (!popup.closed) popup.location.href = challenge.authorizationUrl;
    const callbackUrl = await outcome;
    if (callbackUrl === null) return null;
    return await completeOidc(challenge.transaction, callbackUrl, signal);
  } finally {
    if (!popup.closed) popup.close();
    clearInterval(poll);
    if (closeTimer !== undefined) clearTimeout(closeTimer);
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
  const channel = new BroadcastChannel(CHANNEL_NAME);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      channel.close();
      resolve(false);
    }, ACK_WAIT_MS);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const message = channelMessageSchema.safeParse(event.data);
      if (message.success && message.data.type === "ack") {
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
  return completeOidc(parsed.data.transaction, callbackUrl, signal);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
