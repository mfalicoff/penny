import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { householdDetailQuery, householdsQuery } from "../../api/households";
import { useAccountEmail } from "../../auth/account";
import { Button } from "../../design/controls";
import { Dialog } from "../../design/ModalDialog";
import { LoadingState } from "../../design/states";
import type { EntrySeed, HouseholdScope } from "../entries/scope";
import { householdView } from "./context";
import { describeLoadError } from "./errors";
import { ExpenseFormDialog } from "./ExpenseForm";
import { currentMonth, localDate, people } from "./model";

/**
 * Add entry with a household chosen: reads the household (members, currency) and shows the shared
 * expense form in the same dialog. While it loads, or if it can't be read or changed, the dialog
 * says so and offers to go back to a personal entry with what was typed.
 */
export function SharedEntryDialog({ householdId, seed, scope, onClose }: { householdId: string; seed?: EntrySeed; scope: HouseholdScope; onClose: () => void }) {
  const email = useAccountEmail();
  const detail = useQuery(householdDetailQuery(email, householdId));
  const list = useQuery(householdsQuery(email));
  const backRef = useRef<HTMLButtonElement>(null);
  const back = () => {
    scope.onChoose({ householdId: null }, seed ?? { amount: "", title: "", date: localDate(), accountId: "", note: "", receipt: null });
  };

  if (detail.isSuccess) {
    const archived = list.isSuccess && !list.data.some((household) => household.id === householdId);
    const view = householdView(householdId, detail.data, people(detail.data, email), currentMonth(), archived);
    if (view.canWrite) return <ExpenseFormDialog view={view} target={{ kind: "new" }} onClose={onClose} {...(seed ? { seed } : {})} scope={scope} />;
  }

  const reason = detail.isError
    ? describeLoadError(detail.error)
    : detail.isSuccess
      ? `You can't add expenses to ${detail.data.household.name}: it's archived, or you're no longer a member.`
      : null;
  return (
    <Dialog
      title="New expense"
      {...(reason ? { description: reason } : {})}
      onClose={onClose}
      initialFocus={backRef}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button ref={backRef} variant="secondary" onClick={back}>
            Add as personal
          </Button>
          {detail.isError ? (
            <Button variant="primary" busy={detail.isFetching} onClick={() => void detail.refetch()}>
              Try again
            </Button>
          ) : null}
        </>
      }
    >
      {reason ? null : <LoadingState label="Loading the household…" />}
    </Dialog>
  );
}
