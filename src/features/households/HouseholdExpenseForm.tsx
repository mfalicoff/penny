import type { Household, HouseholdExpense, HouseholdMember, HouseholdRecurring } from "../../data/households";
import { deleteEntry, saveEntry } from "../../domain/commands";
import { kindLabels } from "../../domain/ledger";
import { useHouseholds } from "../../providers/HouseholdProvider";
import { useLedger } from "../../providers/LedgerProvider";
import { EntryForm } from "../entries/EntryForm";

export function HouseholdExpenseForm({ household, members, expense, rule, onClose, onSaved }: {
  household: Household;
  members: HouseholdMember[];
  expense?: HouseholdExpense;
  rule?: HouseholdRecurring;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { ledger, email, commit, showToast, demo } = useLedger();
  const { households, refresh } = useHouseholds();
  const importedCategory = expense && !ledger.categories.some((category) => category.kind === "expense" && category.name === expense.category.name)
    ? { id: `shared:${expense.id}`, kind: "expense" as const, ...expense.category } : undefined;
  return <EntryForm
    categories={importedCategory ? [...ledger.categories, importedCategory] : ledger.categories}
    accounts={ledger.accounts}
    trips={ledger.trips}
    currency={ledger.currency}
    households={households}
    userEmail={email}
    demo={demo}
    commit={commit}
    initialHousehold={household}
    initialMembers={members}
    householdExpense={expense}
    householdRule={rule}
    onHouseholdSaved={async () => { await onSaved(); await refresh(); }}
    onHouseholdFeedback={showToast}
    onSave={(transaction, recurring) => commit((current) => saveEntry(transaction, undefined, recurring)(
      importedCategory && transaction.categoryId === importedCategory.id && !current.categories.some((category) => category.id === importedCategory.id)
        ? { ...current, categories: [...current.categories, importedCategory] } : current,
    ), expense ? "Changes saved" : `${kindLabels[transaction.kind]} added`)}
    onDelete={(id) => commit((current) => {
      const original = current.transactions.find((transaction) => transaction.id === id);
      if (!original) throw new Error("The personal copy changed. Review both entries.");
      const withoutEntry = deleteEntry(original)(current);
      return importedCategory && original.categoryId === importedCategory.id &&
        ![...withoutEntry.transactions, ...withoutEntry.recurring].some((entry) => entry.categoryId === importedCategory.id)
        ? { ...withoutEntry, categories: withoutEntry.categories.filter((category) => category.id !== importedCategory.id) }
        : withoutEntry;
    }, "Move canceled")}
    onClose={onClose}
  />;
}
