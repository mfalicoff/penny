import type { Kind, Receipt } from "@domain/ledger.ts";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { householdsQuery } from "../../api/households";
import type { Household } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";

/**
 * What Add entry carries over when it switches between a personal entry and a household's shared
 * expense, so changing where the expense goes never loses what was typed. The category travels by
 * name: shared expenses store it by value, personal entries by the ledger's id.
 */
export interface EntrySeed {
  amount: string;
  title: string;
  date: string;
  categoryName?: string;
  accountId: string;
  note: string;
  receipt: Receipt | null;
}

/** Where a new entry goes: `householdId: null` is the personal ledger (with the kind to start on). */
export interface ScopeChoice {
  householdId: string | null;
  kind?: Kind;
}

/** The household choice Add entry offers; both forms render it the same way. */
export interface HouseholdScope {
  households: Household[];
  /** The household the form is for, or null for a personal entry. */
  current: string | null;
  onChoose: (choice: ScopeChoice, seed: EntrySeed) => void;
}

/** The households a new entry can go to. Empty while loading, offline or in the demo: Add entry then offers only personal. */
export function useHouseholdChoices(): Household[] {
  const email = useAccountEmail();
  const list = useQuery(householdsQuery(email));
  return list.data ?? [];
}

export const householdLabel = (household: Household) => (household.trip ? `${household.name} (shared trip)` : household.name);

/**
 * "Household" in Add entry: Personal, or one of the account's households and shared trips. Picking
 * one switches the form in place and keeps what was typed (`seed`).
 */
export function HouseholdField({ scope, seed }: { scope: HouseholdScope; seed: () => EntrySeed }) {
  const id = useId();
  const hint = useId();
  const chosen = scope.households.find((household) => household.id === scope.current);
  return (
    <div className="form-field">
      <label htmlFor={id}>Household</label>
      <select
        id={id}
        value={scope.current ?? ""}
        aria-describedby={hint}
        onChange={(event) => {
          const value = event.currentTarget.value;
          scope.onChoose({ householdId: value || null }, seed());
        }}
      >
        <option value="">Personal (just me)</option>
        {scope.households.map((household) => (
          <option key={household.id} value={household.id}>
            {householdLabel(household)}
          </option>
        ))}
        {/* A household not in the list (still loading, or opened from its own page) stays selected. */}
        {scope.current && !chosen ? <option value={scope.current}>This household</option> : null}
      </select>
      <span id={hint} className="form-hint">
        {chosen ? `Shared with ${chosen.name}: everyone there sees the full amount, and only your share counts in your spending.` : "Choose a household to split this expense with its members."}
      </span>
    </div>
  );
}
