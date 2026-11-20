import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { deleteRule, recurringQuery, refreshHousehold, updateRule } from "../../api/households";
import type { SharedRecurring } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";
import { Badge, Button } from "../../design/controls";
import { Dialog } from "../../design/ModalDialog";
import { Money } from "../../design/Money";
import { EmptyState, ErrorState, LoadingState, SaveErrorBanner, useToast } from "../../design/states";
import type { HouseholdView } from "./context";
import { describeLoadError, describeSharedError } from "./errors";
import { dayLabel } from "./model";

const FREQUENCY: Record<SharedRecurring["frequency"], string> = { weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };

/**
 * One repeating shared expense (MAZ-229). The cards draw no Repeating card on the household, so a
 * rule opens from an expense it added (Repeating expense in the expense's detail) or from
 * Recurring (`?rule=`). Edit, Pause or Resume, and Stop repeating are here. The server records
 * each occurrence on its date, split among the members active then.
 */
export function RuleDialog({ view, ruleId, onEdit, onClose }: { view: HouseholdView; ruleId: string; onEdit: (rule: SharedRecurring) => void; onClose: () => void }) {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const toast = useToast();
  const rules = useQuery(recurringQuery(email, view.householdId));
  const [removing, setRemoving] = useState(false);
  const rule = rules.data?.find((item) => item.id === ruleId);

  const toggle = useMutation({
    mutationKey: ["households", "rule", "toggle"],
    mutationFn: (current: SharedRecurring) =>
      updateRule(view.householdId, current.id, {
        title: current.title,
        totalCents: current.totalCents,
        payerUserId: current.payerUserId,
        splitMode: current.splitMode,
        ...(current.allocations ? { allocations: current.allocations } : {}),
        category: current.category,
        note: current.note,
        ...(current.accountId ? { accountId: current.accountId } : {}),
        ...(current.receiptId ? { receiptId: current.receiptId } : {}),
        nextDate: current.nextDate,
        frequency: current.frequency,
        active: !current.active,
        revision: current.revision,
      }),
    onSuccess: async ({ rule: saved }) => {
      await refreshHousehold(queryClient, email, view.householdId);
      toast.show({ title: saved.active ? `${saved.title} resumed` : `${saved.title} paused` });
    },
    onError: () => void rules.refetch(),
  });

  if (rule && removing) return <RemoveRuleDialog view={view} rule={rule} onClose={onClose} onCancel={() => { setRemoving(false); }} />;

  let body;
  if (rules.isPending) body = <LoadingState label="Loading the repeating expense…" />;
  else if (!rules.data) {
    body = (
      <ErrorState onRetry={() => void rules.refetch()} retrying={rules.isFetching}>
        {describeLoadError(rules.error)}
      </ErrorState>
    );
  } else if (!rule) {
    body = (
      <EmptyState icon="repeat" title="This expense no longer repeats">
        <p>Someone stopped it. Expenses it already added stay as they are.</p>
      </EmptyState>
    );
  } else {
    body = (
      <>
        {toggle.isError ? <SaveErrorBanner message={describeSharedError(toggle.error).message} /> : null}
        <dl className="detail-grid">
          <dt>Amount</dt>
          <dd>
            <Money cents={rule.totalCents} currency={view.currency} />
          </dd>
          <dt>Repeats</dt>
          <dd>
            {FREQUENCY[rule.frequency]}
            {rule.active ? null : (
              <>
                {" "}
                <Badge tone="pending">Paused</Badge>
              </>
            )}
          </dd>
          <dt>Next</dt>
          <dd>
            <time dateTime={rule.nextDate}>{dayLabel(rule.nextDate, true)}</time>
          </dd>
          <dt>Paid by</dt>
          <dd>{view.who.name(rule.payerUserId)}</dd>
        </dl>
        <p className="note">Penny adds each occurrence on its date, split among the members active then. Past occurrences don't change.</p>
      </>
    );
  }

  return (
    <Dialog
      title={rule?.title ?? "Repeating expense"}
      onClose={onClose}
      actions={
        rule && view.canWrite ? (
          <>
            <Button variant="danger-quiet" onClick={() => { setRemoving(true); }}>
              Stop repeating
            </Button>
            <Button icon={rule.active ? "pause" : "play"} busy={toggle.isPending} onClick={() => { toggle.mutate(rule); }} aria-label={`${rule.active ? "Pause" : "Resume"} ${rule.title}`}>
              {rule.active ? "Pause" : "Resume"}
            </Button>
            <Button variant="primary" icon="create" onClick={() => { onEdit(rule); }} aria-label={`Edit ${rule.title}`}>
              Edit
            </Button>
          </>
        ) : undefined
      }
    >
      {body}
    </Dialog>
  );
}

function RemoveRuleDialog({ view, rule, onClose, onCancel }: { view: HouseholdView; rule: SharedRecurring; onClose: () => void; onCancel: () => void }) {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const toast = useToast();
  const remove = useMutation({
    mutationKey: ["households", "rule", "delete"],
    mutationFn: () => deleteRule(view.householdId, rule.id, rule.revision),
    onSuccess: async () => {
      await refreshHousehold(queryClient, email, view.householdId);
      toast.show({ title: `${rule.title} no longer repeats` });
      onClose();
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: recurringQuery(email, view.householdId).queryKey }),
  });
  return (
    <Dialog
      title={`Stop repeating ${rule.title}?`}
      description="Future occurrences stop for everyone. Expenses already added stay as they are."
      onClose={onClose}
      actions={
        <>
          <Button variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" busy={remove.isPending} onClick={() => { remove.mutate(); }}>
            {remove.isPending ? "Removing…" : "Stop repeating"}
          </Button>
        </>
      }
    >
      {remove.isError ? <SaveErrorBanner message={describeSharedError(remove.error).message} /> : null}
    </Dialog>
  );
}
