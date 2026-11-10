/**
 * Query key conventions (see README "Cache and session ownership").
 *
 * - `["server", ...]` is public, credential-free data (server info, SSO availability).
 * - `["session"]` is who the browser is signed in as. It is the only private-looking key
 *   that survives a sign-out, and it holds just the account email.
 * - `["user", email, ...]` is everything private. The email is part of the key, so two
 *   accounts can never read each other's cached data, and `clearPrivateData` can remove
 *   all of it by prefix when the account changes or the session ends.
 */
export const sessionKey = ["session"] as const;
export const sessionNoticeKey = ["session", "notice"] as const;

export function userKey(email: string, ...rest: readonly unknown[]) {
  return ["user", email, ...rest] as const;
}

/** True for every query that holds one account's private data. */
export function isPrivateKey(key: readonly unknown[]): boolean {
  return key[0] === "user";
}
