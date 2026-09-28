import type { Household, HouseholdExpense, HouseholdMember, HouseholdRecurring } from "../../data/households";
import { saveEntry } from "../../domain/commands";
import { kindLabels } from "../../domain/ledger";
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
  const { ledger, email, commit, demo } = useLedger();
  return <EntryForm
    categories={ledger.categories}
    accounts={ledger.accounts}
    trips={ledger.trips}
    currency={household.currency}
    userEmail={email}
    demo={demo}
    commit={commit}
    initialHousehold={household}
    initialMembers={members}
    householdExpense={expense}
    householdRule={rule}
    onHouseholdSaved={onSaved}
    onSave={(transaction, recurring) => commit(saveEntry(transaction, undefined, recurring), `${kindLabels[transaction.kind]} added`)}
    onClose={onClose}
  />;
}
