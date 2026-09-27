import { kindLabels } from "../../domain/ledger";
import { deleteEntry, saveEntry } from "../../domain/commands";
import { useLedger } from "../../providers/LedgerProvider";
import { useWorkspace } from "../../providers/WorkspaceProvider";
import { EntryForm } from "./EntryForm";

export function EntryDialog() {
  const { ledger, demo, commit } = useLedger();
  const { form, setForm, setMonth, setDay } = useWorkspace();
  if (!form) return null;
  return <EntryForm
    demo={demo}
    categories={ledger.categories}
    entry={form.entry}
    currency={ledger.currency}
    onClose={() => setForm(null)}
    onSave={async (transaction, recurring) => {
      await commit(saveEntry(transaction, form.entry, recurring), form.entry ? "Changes saved" : `${kindLabels[transaction.kind]} added`);
      setMonth(transaction.date.slice(0, 7));
      setDay(null);
    }}
    onDelete={async () => {
      if (form.entry) await commit(deleteEntry(form.entry), "Entry deleted");
    }}
  />;
}
