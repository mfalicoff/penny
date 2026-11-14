import type { Kind } from "@domain/ledger.ts";
import { useState } from "react";
import { SharedEntryDialog } from "../households/SharedEntryDialog";
import { EntryFormDialog } from "./EntryForm";
import { useHouseholdChoices, type EntrySeed, type HouseholdScope } from "./scope";

type Scope = { householdId: string | null; kind?: Kind; seed?: EntrySeed; generation: number };

/**
 * Add entry (web card `web-add-entry`): a dialog over the current page, opened by the top bar
 * button, N, a deep link to `/entries/new`, or a household's Shared expense button (`householdId`).
 * Esc closes it and keeps the draft for next time; ⌘↵ or Ctrl+Enter saves.
 *
 * Household chooses where an expense goes: Personal writes through the durable offline store
 * (MAZ-88); a household or shared trip shows the shared form in the same dialog and layout, online
 * only. Switching keeps what was typed.
 */
export function AddEntryDialog({ onClose, householdId }: { onClose: () => void; householdId?: string }) {
  const households = useHouseholdChoices();
  const [scope, setScope] = useState<Scope>({ householdId: householdId ?? null, generation: 0 });
  const choice: HouseholdScope = {
    households,
    current: scope.householdId,
    onChoose: (next, seed) => {
      setScope((previous) => ({ householdId: next.householdId, ...(next.kind ? { kind: next.kind } : {}), seed, generation: previous.generation + 1 }));
    },
  };
  if (scope.householdId) {
    return <SharedEntryDialog key={`${scope.householdId}-${String(scope.generation)}`} householdId={scope.householdId} {...(scope.seed ? { seed: scope.seed } : {})} scope={choice} onClose={onClose} />;
  }
  return (
    <EntryFormDialog
      key={`personal-${String(scope.generation)}`}
      target={{ kind: "new", ...(scope.kind ? { entryKind: scope.kind } : {}) }}
      {...(scope.seed ? { seed: scope.seed } : {})}
      scope={choice}
      onClose={onClose}
    />
  );
}
