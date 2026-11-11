/**
 * Pending-change protection. Edits made offline are stored durably outside TanStack Query
 * (the browser offline store, MAZ-87, `src/offline/`) and may not have reached the server yet.
 * Signing out would strand them, so the sign-out flow asks this registry first and refuses when the
 * active account still has unsynced edits (the legacy Expo app behaves the same way).
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
  /** The server session is gone: remove what the browser kept for `email`, unless something became pending. */
  finishSignOut(email: string): Promise<void>;
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

export async function hasPendingChanges(email: string): Promise<boolean> {
  if (typeof source === "function") return source(email);
  const count = await source.beginSignOut(email);
  source.cancelSignOut(email);
  return count > 0;
}

export interface SignOutHold {
  pending: number;
  cancel(): void;
  finish(): Promise<void>;
}

/**
 * Starts sign-out: holds the account's saves and reports what is pending. The caller signs out on
 * the server only when `pending` is 0, then calls `finish`; otherwise (or if that fails) `cancel`.
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
    finish: () => current.finishSignOut(email),
  };
}
