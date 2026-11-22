import type { Kind, Receipt } from "@domain/ledger.ts";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { householdsQuery } from "../../api/households";
import type { Household } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";
import { DetailList, DetailRow } from "./EntryParts";

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
 * one switches the form in place and keeps what was typed (`seed`). `row` draws it as the cards'
 * Household row (after Trip on `iphone-entry-extras`, `ipad-add-entry` and `web-add-entry`), with the
 * hint read by assistive technology only; the default is a labelled field with a visible hint.
 */
export function HouseholdField({ scope, seed, variant = "field", chevron }: { scope: HouseholdScope; seed: () => EntrySeed; variant?: "field" | "row"; chevron?: "down" | "forward" }) {
  const id = useId();
  const hint = useId();
  const chosen = scope.households.find((household) => household.id === scope.current);
  const hintText = chosen ? `Shared with ${chosen.name}: everyone there sees the full amount, and only your share counts in your spending.` : "Choose a household to split this expense with its members.";
  const select = (
    <select
      id={id}
      className={variant === "row" ? "entry-row__select" : undefined}
      value={scope.current ?? ""}
      aria-describedby={hint}
      onChange={(event) => {
        const value = event.currentTarget.value;
        scope.onChoose({ householdId: value || null }, seed());
      }}
    >
      <option value="">Personal</option>
      {scope.households.map((household) => (
        <option key={household.id} value={household.id}>
          {householdLabel(household)}
        </option>
      ))}
      {/* A household not in the list (still loading, or opened from its own page) stays selected. */}
      {scope.current && !chosen ? <option value={scope.current}>This household</option> : null}
    </select>
  );
  if (variant === "row") {
    // The hint sits inside the row, so the rows' separators (`.entry-row + .entry-row`) still apply.
    return (
      <DetailRow icon="home" label="Household" htmlFor={id} {...(chevron ? { chevron } : {})}>
        {select}
        <span id={hint} className="visually-hidden">
          {hintText}
        </span>
      </DetailRow>
    );
  }
  return (
    <div className="form-field">
      <label htmlFor={id}>Household</label>
      {select}
      <span id={hint} className="form-hint">
        {hintText}
      </span>
    </div>
  );
}

/** The Household row in its own inset list, as `iphone-entry-extras` draws it under Trip. */
export function HouseholdRowList(props: { scope: HouseholdScope; seed: () => EntrySeed }) {
  return (
    <DetailList>
      <HouseholdField {...props} variant="row" chevron="forward" />
    </DetailList>
  );
}
