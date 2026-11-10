/**
 * Pending-change protection. Edits made offline are stored durably outside TanStack Query
 * (the browser offline store, MAZ-87) and may not have reached the server yet. Signing out
 * would strand them, so the sign-out flow asks this registry first and refuses when the
 * active account still has unsynced edits (the legacy Expo app behaves the same way).
 *
 * Nothing in the Query cache counts as pending: Query only holds server copies that can
 * always be fetched again, which is why clearing it on sign-out is safe.
 */
export type PendingChangesCheck = (email: string) => boolean | Promise<boolean>;

let check: PendingChangesCheck = () => false;

/** The offline store registers itself here. Returns a function that removes it again. */
export function registerPendingChanges(source: PendingChangesCheck): () => void {
  check = source;
  return () => {
    if (check === source) check = () => false;
  };
}

export async function hasPendingChanges(email: string): Promise<boolean> {
  return check(email);
}
