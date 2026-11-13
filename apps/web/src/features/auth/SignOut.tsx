import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { logout } from "../../api/auth";
import { ApiError } from "../../api/client";
import { useAccountEmail } from "../../auth/account";
import { endSession } from "../../auth/lifecycle";
import { beginSignOut } from "../../auth/pendingChanges";
import { Icon } from "../../design/Icon";
import { ModalDialog } from "../../design/ModalDialog";
import { describeAuthError } from "./AuthScreen";

/** Sign out and its confirmation (redesign specimen "sign-out"), shown in Settings › Account. */
export function SignOutButton() {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  const signOut = useMutation({
    mutationKey: ["auth", "logout"],
    mutationFn: async () => {
      // The hold stops saves (in this tab) between the check and removing this browser's copy.
      const hold = await beginSignOut(email);
      if (hold.pending > 0) {
        hold.cancel();
        throw new Error("Your changes are still waiting to sync. Connect and retry before signing out.");
      }
      try {
        await logout();
      } catch (failure) {
        hold.cancel();
        throw failure;
      }
      // Signed out on the server. Removing the local copy is best effort: it holds nothing unsynced.
      await hold.finish().catch(() => undefined);
    },
    onSuccess: () => endSession(queryClient),
    onError: (failure) => {
      setError(failure instanceof Error && !(failure instanceof ApiError) ? failure.message : describeAuthError(failure));
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
        <ModalDialog labelledBy={titleId} onClose={close}>
          <h2 id={titleId}>Sign out of Penny?</h2>
          <p>This removes the data Penny kept in this browser. Your account and ledger stay on the server.</p>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="dialog__actions">
            <button ref={cancelRef} type="button" className="button button--secondary" onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              className="button button--danger"
              aria-disabled={signOut.isPending}
              onClick={() => {
                if (!signOut.isPending) signOut.mutate();
              }}
            >
              {signOut.isPending ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </ModalDialog>
      ) : null}
    </>
  );
}
