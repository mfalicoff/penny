import type { QueryClient } from "@tanstack/react-query";
import { isPrivateKey, sessionKey, sessionNoticeKey } from "../api/keys";

export type SessionNotice = "expired" | null;

/**
 * Removes every cached private query and forgets finished mutations. Removing a query
 * also aborts its request, and a response that arrives later has no query to land in,
 * so a late reply can never put the previous account's data back.
 */
export function clearPrivateData(queryClient: QueryClient): void {
  queryClient.removeQueries({ predicate: (query) => isPrivateKey(query.queryKey) });
  queryClient.getMutationCache().clear();
}

/** An in-flight `/me` from before the change must not overwrite the new identity. */
async function dropInFlightSession(queryClient: QueryClient): Promise<void> {
  await queryClient.cancelQueries({ queryKey: sessionKey, exact: true });
}

/**
 * A sign-in or registration succeeded: the browser now belongs to `email`. Anything
 * cached for a different account is discarded first.
 */
export async function beginSession(queryClient: QueryClient, email: string): Promise<void> {
  await dropInFlightSession(queryClient);
  const previous = queryClient.getQueryData<{ email: string } | null>(sessionKey);
  if (previous?.email !== email) clearPrivateData(queryClient);
  queryClient.setQueryData(sessionKey, { email });
  queryClient.setQueryData(sessionNoticeKey, null);
}

/** The user signed out (the server session is already gone). */
export async function endSession(queryClient: QueryClient): Promise<void> {
  await dropInFlightSession(queryClient);
  queryClient.setQueryData(sessionKey, null);
  queryClient.setQueryData(sessionNoticeKey, null);
  clearPrivateData(queryClient);
}

/**
 * The server rejected the session (30-day expiry, revoked elsewhere). The app returns to
 * sign-in with a notice. Durable offline edits live outside Query, so they are untouched
 * and survive until the owner signs back in.
 */
export async function expireSession(queryClient: QueryClient, options: { cancelSession?: boolean } = {}): Promise<void> {
  // A `/me` request still in flight must not restore the signed-in state when it resolves.
  // The `/me` query itself passes `cancelSession: false`: it is the caller and is already settling.
  if (options.cancelSession !== false) await dropInFlightSession(queryClient);
  queryClient.setQueryData(sessionKey, null);
  queryClient.setQueryData(sessionNoticeKey, "expired" satisfies SessionNotice);
  clearPrivateData(queryClient);
}
