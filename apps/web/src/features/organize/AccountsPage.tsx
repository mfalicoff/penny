import { useId, useMemo, useState } from "react";
import type { PaymentAccount } from "@domain/ledger.ts";
import { Button } from "../../design/controls";
import { Banner, EmptyState, ErrorState, LoadingState, useToast } from "../../design/states";
import { AccountFormDialog } from "./AccountFormDialog";
import { ManageAdd } from "./ManageAdd";
import { OrganizeRow } from "./OrganizeRow";
import { ACCOUNT_TYPE_ICONS, accountTypeLabels, accountUsage, refusedAccountRemovals, restoreAccount, unsyncedIds, usageOf, usageText, type Usage } from "./model";
import { describeSaveError, useLedgerWorkspace, type LedgerWorkspace } from "./workspace";

/**
 * Accounts (cards `iphone-accounts`, `iphone-account-form`): labels for how you pay and get
 * paid, with how many entries and schedules use each. No balances and no bank connection.
 * Changes are saved in this browser first and sync from there (MAZ-87).
 */
export function AccountsPage() {
  const workspace = useLedgerWorkspace();
  const [form, setForm] = useState<{ account?: PaymentAccount } | null>(null);
  const headingId = useId();
  const noteId = useId();
  const { ledger, server } = workspace;

  const usage = useMemo(() => (ledger ? accountUsage(ledger) : new Map<string, Usage>()), [ledger]);
  const waiting = useMemo(() => (ledger ? unsyncedIds(ledger.accounts, server?.accounts ?? null) : new Set<string>()), [ledger, server]);

  if (workspace.status === "loading") return <LoadingState label="Loading your accounts…" />;
  if (workspace.status === "error" || !ledger) {
    return (
      <ErrorState title="Penny couldn't load your accounts" onRetry={workspace.retry} retrying={workspace.retrying}>
        {workspace.loadError} Nothing was changed.
      </ErrorState>
    );
  }

  const open = () => {
    setForm({});
  };

  return (
    <div className="page organize">
      <ManageAdd label="Add account" onClick={open} />
      <RefusedRemovals workspace={workspace} />
      <p className="page__subtitle">Labels for how you pay and get paid.</p>
      {ledger.accounts.length === 0 ? (
        <EmptyState
          icon="wallet"
          title="Where your money lives"
        >
          <p>Start with a bank account, a credit card or the cash in your pocket. Penny never connects to your bank and doesn't track balances.</p>
        </EmptyState>
      ) : (
        <section className="organize-section" aria-labelledby={headingId}>
          <h2 id={headingId} className="group-label">
            Your accounts
          </h2>
          <ul className="group-list group-list--inset organize-list--accounts" aria-describedby={noteId}>
            {ledger.accounts.map((account) => (
              <OrganizeRow
                key={account.id}
                name={account.name}
                meta={`${accountTypeLabels[account.type]} · ${usageText(usageOf(usage, account.id))}`}
                icon={ACCOUNT_TYPE_ICONS[account.type]}
                waiting={waiting.has(account.id)}
                edit
                onOpen={() => {
                  setForm({ account });
                }}
              />
            ))}
          </ul>
          <p id={noteId} className="group-note">
            Penny never connects to your bank and doesn't track balances. An account linked to entries or schedules can be renamed, but not removed until those are moved to another account.
          </p>
        </section>
      )}
      {form ? (
        <AccountFormDialog
          {...(form.account ? { account: form.account } : {})}
          workspace={{ ledger, save: workspace.save }}
          onClose={() => {
            setForm(null);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The server is the only one that knows which shared expenses you paid with an account. When it
 * refuses a sync because this browser removed such an account, nothing else syncs either, so this
 * offers to put the account back (the rest of the work then syncs) and says how to remove it.
 */
function RefusedRemovals({ workspace }: { workspace: LedgerWorkspace }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { ledger, server, sync } = workspace;
  const refused = ledger ? refusedAccountRemovals(sync?.issue?.message, ledger, server) : [];
  if (!refused.length) return null;
  const names = refused.map((account) => account.name).join(", ");
  return (
    <Banner
      tone="error"
      title={`${names} can't be removed yet`}
      action={
        <Button
          variant="secondary"
          busy={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            void refused
              .reduce<Promise<unknown>>((previous, account) => previous.then(() => workspace.save(restoreAccount(account))), Promise.resolve())
              .then(() => {
                toast.show({ title: refused.length === 1 ? `${names} is back` : "Accounts are back", detail: "Your other changes can sync now." });
              })
              .catch((reason: unknown) => {
                setError(describeSaveError(reason));
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          {refused.length === 1 ? "Put it back" : "Put them back"}
        </Button>
      }
    >
      A shared expense or repeating shared expense you paid is linked to {refused.length === 1 ? "it" : "them"}, so the server kept {refused.length === 1 ? "it" : "them"} and none of your
      changes have synced. Put {refused.length === 1 ? "it" : "them"} back to sync the rest, then remove the account from those shared expenses before removing it here.
      {error ? <span className="form-error"> {error}</span> : null}
    </Banner>
  );
}
