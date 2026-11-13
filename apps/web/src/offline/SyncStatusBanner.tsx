import { useState } from "react";
import { Button } from "../design/controls";
import { Banner, OfflineBanner, useOnline } from "../design/states";
import { useLedgerEngine, useLedgerSync } from "./OfflineLedgerProvider";

const changes = (count: number) => `${count} change${count === 1 ? "" : "s"} waiting`;

/**
 * The shell's sync status (redesign specimen `offline`: "Offline · 2 changes waiting", Retry), plus
 * the storage states only the browser has. Every message says the work is kept and names the
 * next step. In the demo there is no store, so it falls back to the plain offline banner.
 */
export function SyncStatusBanner() {
  const engine = useLedgerEngine();
  const state = useLedgerSync();
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  if (!engine || !state) return <OfflineBanner />;

  const pending = state.pending.count;
  const run = (action: () => Promise<void> | void) => {
    setBusy(true);
    setActionError(null);
    void Promise.resolve()
      .then(action)
      .catch((error: unknown) => {
        setActionError(error instanceof Error ? error.message : "That didn't work. Try again.");
      })
      .finally(() => {
        setBusy(false);
      });
  };
  const retry = (
    <Button
      variant="secondary"
      busy={busy || state.phase === "syncing"}
      onClick={() => {
        run(() => engine.syncNow());
      }}
    >
      Retry
    </Button>
  );

  let main = null;
  if (state.phase === "storageNewerFormat") {
    main = (
      <Banner
        tone="error"
        title="Penny was updated in another tab"
        action={
          <Button
            variant="secondary"
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload
          </Button>
        }
      >
        A newer version saved your data in this browser. Reload to keep working; nothing was changed.
      </Banner>
    );
  } else if (state.phase === "storageUnreadable") {
    main = (
      <Banner
        tone="error"
        title="Penny can't read what it saved in this browser"
        action={
          <Button
            variant="secondary"
            busy={busy}
            onClick={() => {
              run(() => engine.recoverUnreadableStorage());
            }}
          >
            Set aside and download again
          </Button>
        }
      >
        Saving is paused. Setting the damaged copy aside downloads your ledger from the server again; changes that were only in that copy can't be recovered.
      </Banner>
    );
  } else if (state.phase === "storageUnavailable") {
    main = (
      <Banner tone="error" title="This browser isn't keeping Penny's data">
        Private browsing or a site setting is blocking storage. You can look at your ledger, but changes can't be saved in this browser.
      </Banner>
    );
  } else if (!online || state.phase === "offline") {
    main = (
      <Banner tone="offline" title={pending > 0 ? `Offline · ${changes(pending)}` : "You're offline"} action={pending > 0 ? retry : undefined}>
        {pending > 0
          ? "Your changes are saved in this browser and sync when you're back online."
          : "Penny shows what it already loaded. Changes you can't save yet stay in their form until you're back online."}
      </Banner>
    );
  } else if (state.issue && (state.issue.kind === "serverUnreachable" || state.issue.kind === "serverUnavailable")) {
    // The shell already says the server can't be reached; only add what is waiting.
    if (pending > 0)
      main = (
        <Banner tone="offline" title={`Not synced · ${changes(pending)}`} action={retry}>
          {state.issue.message}
        </Banner>
      );
  } else if (state.issue) {
    main = (
      <Banner tone="error" title={pending > 0 ? `Couldn't sync · ${changes(pending)}` : "Couldn't sync"} action={retry}>
        {state.issue.message}
      </Banner>
    );
  }

  return (
    <>
      {main}
      {state.legacyUnreadable ? (
        <Banner
          tone="error"
          title="Changes from the previous Penny web app couldn't be read"
          action={
            <Button
              variant="secondary"
              busy={busy}
              onClick={() => {
                run(() => {
                  engine.setLegacyCopyAside();
                });
              }}
            >
              Set aside
            </Button>
          }
        >
          They're kept in this browser, and you can't sign out until you set them aside.
        </Banner>
      ) : null}
      {actionError ? (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      ) : null}
    </>
  );
}
