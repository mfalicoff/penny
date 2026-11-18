/**
 * Pending-change protection. Edits made offline are stored durably outside TanStack Query
 * (the browser offline store, MAZ-87, `src/offline/`) and may not have reached the server yet.
 * Signing out would strand them, so the sign-out flow asks this registry first. With unsynced
 * edits it offers "Sync, then sign out" and "Sign out anyway", and removes them only with that
 * consent (the iOS app behaves the same way).
 *
 * Nothing in the Query cache counts as pending: Query only holds server copies that can
 * always be fetched again, which is why clearing it on sign-out is safe.
 */
export type PendingChangesCheck = (email: string) => boolean | Promise<boolean>;

/** What the offline store offers sign-out: a hold so no save lands between the check and the removal. */
export interface LocalAccountData {
  /** Holds saves for `email` and returns how many changes are still unsynced. */
  beginSignOut(email: string): Promise<number>;
  /** Sign-out didn't go ahead: lift the hold. */
  cancelSignOut(email: string): void;
  /** The server session is gone: remove what the browser kept for `email`, unless more than `discardUpTo` changes are pending. */
  finishSignOut(email: string, discardUpTo?: number): Promise<void>;
}

type Source = PendingChangesCheck | LocalAccountData;

let source: Source = () => false;

/** The offline store registers itself here. Returns a function that removes it again. */
export function registerPendingChanges(next: Source): () => void {
  source = next;
  return () => {
    if (source === next) source = () => false;
  };
}

export interface SignOutHold {
  pending: number;
  cancel(): void;
  /** Removes this browser's copy. `discardUpTo`: how many unsynced changes the person agreed to lose ("Sign out anyway"). */
  finish(discardUpTo?: number): Promise<void>;
}

/**
 * Starts sign-out: holds the account's saves and reports what is pending. The caller signs out on
 * the server only when `pending` is 0, or no more than the person agreed to lose, then calls
 * `finish`; otherwise (or if that fails) `cancel`.
 */
export async function beginSignOut(email: string): Promise<SignOutHold> {
  const current = source;
  if (typeof current === "function") {
    const pending = (await current(email)) ? 1 : 0;
    return { pending, cancel: () => undefined, finish: () => Promise.resolve() };
  }
  const pending = await current.beginSignOut(email);
  return {
    pending,
    cancel: () => {
      current.cancelSignOut(email);
    },
    finish: (discardUpTo) => current.finishSignOut(email, discardUpTo),
  };
}
