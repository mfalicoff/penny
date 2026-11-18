import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { logout } from "../../api/auth";
import { useAccountEmail } from "../../auth/account";
import { endSession } from "../../auth/lifecycle";
import { beginSignOut } from "../../auth/pendingChanges";
import { Icon } from "../../design/Icon";
import { ModalDialog } from "../../design/ModalDialog";
import { useLedgerEngine, useLedgerSync } from "../../offline/OfflineLedgerProvider";
import { describeAuthError } from "./AuthScreen";

type Request =
  /** "Sync, then sign out": send what is waiting first; nothing is removed if any of it doesn't sync. */
  | { kind: "sync" }
  /** "Sign out" or "Sign out anyway", with how many unsynced changes the person agreed to lose. */
  | { kind: "sign-out"; discardUpTo: number };

/** Expected refusals, shown as they are (not as a server error). */
class SignOutRefused extends Error {}

/** iOS wording (`SignOutButton.title`): "1 change hasn’t synced", "2 changes haven’t synced". */
const unsyncedTitle = (count: number) => (count === 1 ? "1 change hasn’t synced" : `${String(count)} changes haven’t synced`);

/**
 * Sign out and its confirmation (redesign card `iphone-sign-out`), shown in Settings › Account. With
 * changes waiting to sync it warns that they would be lost and offers "Sync, then sign out" and
 * "Sign out anyway", as on iOS. Nothing is removed from this browser unless the person chooses to.
 */
export function SignOutButton() {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const engine = useLedgerEngine();
  const pending = useLedgerSync()?.pending.count ?? 0;
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const host = window.location.host;

  const signOut = useMutation({
    mutationKey: ["auth", "logout"],
    mutationFn: async (request: Request) => {
      if (request.kind === "sync" && engine) await engine.syncNow();
      const discardUpTo = request.kind === "sign-out" ? request.discardUpTo : 0;
      // The hold stops saves (in this tab) between the check and removing this browser's copy.
      const hold = await beginSignOut(email);
      if (hold.pending > discardUpTo) {
        hold.cancel();
        throw new SignOutRefused(
          request.kind === "sync"
            ? "Couldn't sync your changes. Nothing was removed. Check your connection and try again."
            : "More changes are waiting to sync now. Nothing was removed. Choose again.",
        );
      }
      try {
        await logout();
      } catch (failure) {
        hold.cancel();
        throw failure;
      }
      // Signed out on the server. Removing the local copy is best effort.
      await hold.finish(discardUpTo).catch(() => undefined);
    },
    onSuccess: () => endSession(queryClient),
    onError: (failure) => {
      setError(failure instanceof SignOutRefused ? failure.message : describeAuthError(failure));
    },
  });

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    setError(null);
    opener.current?.focus();
  }

  function run(request: Request) {
    if (signOut.isPending) return;
    setError(null);
    signOut.mutate(request);
  }

  const busy = signOut.isPending;
  const syncing = busy && signOut.variables.kind === "sync";

  return (
    <>
      <button
        ref={opener}
        type="button"
        className="wbtn wbtn--danger-quiet"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Icon name="log-out" size={20} />
        Sign out
      </button>
      {open ? (
        <ModalDialog labelledBy={titleId} describedBy={messageId} onClose={close}>
          {pending > 0 ? (
            <>
              <h2 id={titleId}>{unsyncedTitle(pending)}</h2>
              <p id={messageId}>
                Signing out removes your entries from this browser. Synced entries stay safe on {host}; {pending === 1 ? "this one" : `these ${String(pending)}`} would be lost.
              </p>
            </>
          ) : (
            <>
              <h2 id={titleId}>Sign out of Penny?</h2>
              <p id={messageId}>Your entries are removed from this browser and stay safe on {host}.</p>
            </>
          )}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          {pending > 0 ? (
            <div className="dialog__actions dialog__actions--stack">
              <button
                type="button"
                className="button"
                aria-disabled={busy}
                onClick={() => {
                  run({ kind: "sync" });
                }}
              >
                {syncing ? "Syncing…" : "Sync, then sign out"}
              </button>
              <button
                type="button"
                className="button button--danger"
                aria-disabled={busy}
                onClick={() => {
                  run({ kind: "sign-out", discardUpTo: pending });
                }}
              >
                {busy && !syncing ? "Signing out…" : "Sign out anyway"}
              </button>
              <button ref={cancelRef} type="button" className="button button--secondary" onClick={close}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="dialog__actions">
              <button ref={cancelRef} type="button" className="button button--secondary" onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="button button--danger"
                aria-disabled={busy}
                onClick={() => {
                  run({ kind: "sign-out", discardUpTo: 0 });
                }}
              >
                {busy ? "Signing out…" : "Sign out"}
              </button>
            </div>
          )}
        </ModalDialog>
      ) : null}
    </>
  );
}
