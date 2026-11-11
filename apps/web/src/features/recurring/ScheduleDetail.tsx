import { removeSchedule, setScheduleActive } from "@domain/commands.ts";
import { dateKey, type Ledger, type Recurring } from "@domain/ledger.ts";
import { Badge, Button } from "../../design/controls";
import { Dialog } from "../../design/ModalDialog";
import { Money } from "../../design/Money";
import { SaveErrorBanner, useToast } from "../../design/states";
import { accountOf, cadenceLabel, categoryOf, dayLabel, relativeDay, resumeDate, shortDay, TONE, upcomingDates, type ScheduleView } from "./model";
import { savedDetail, useScheduleSave } from "./save";

interface DetailProps {
  ledger: Ledger;
  id: string;
  waiting: boolean;
  readOnly: boolean;
  onClose: () => void;
  onNavigate: (view: ScheduleView) => void;
}

/**
 * Schedule detail (card `iphone-schedule-detail`, specimen `schedule`): amount and cadence, Edit,
 * a separate Pause or Resume, the next dates, details, and Remove schedule, which asks first. It
 * follows the live ledger, so a sync or another tab updates it while it is open.
 */
export function ScheduleDetailDialog({ ledger, id, waiting, readOnly, onClose, onNavigate }: DetailProps) {
  const toast = useToast();
  const { save, saving, error } = useScheduleSave();
  const rule = ledger.recurring.find((item) => item.id === id);

  if (!rule) {
    return (
      <Dialog
        title="Schedule removed"
        description="This schedule was removed, possibly on another device. Entries it already recorded stay in your activity."
        onClose={onClose}
        actions={
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        }
      />
    );
  }

  const today = dateKey();
  const category = categoryOf(ledger, rule.categoryId);
  const account = accountOf(ledger, rule.accountId);
  const recorded = ledger.transactions.filter((entry) => entry.recurringId === rule.id).length;
  const next = upcomingDates(rule, 3);
  const resumesOn = resumeDate(rule, today);

  async function toggle(current: Recurring) {
    const receipt = await save(setScheduleActive(current.id, !current.active, dateKey()));
    if (!receipt) return;
    toast.show(
      current.active
        ? { title: `${current.title} paused`, detail: savedDetail(receipt, "Penny skips its dates until you resume it.") }
        : { title: `${current.title} resumed`, detail: savedDetail(receipt, `Next on ${dayLabel(resumeDate(current, dateKey()))}.`) },
    );
  }

  return (
    <Dialog title={rule.title} description={cadenceLabel(rule)} onClose={onClose} wide>
      <div className="schedule-detail">
        {error ? (
          <SaveErrorBanner
            message={error}
            onRetry={() => {
              void toggle(rule);
            }}
            retrying={saving}
          />
        ) : null}
        <div className="schedule-detail__summary">
          <Money cents={rule.share} currency={ledger.currency} tone={TONE[rule.kind]} className="schedule-detail__amount" />
          <span className="schedule-detail__badges">
            {rule.active ? <Badge tone="income" icon="repeat">Active</Badge> : <Badge icon="pause">Paused</Badge>}
            {waiting ? <Badge tone="pending" icon="cloud-offline">Waiting to sync</Badge> : null}
          </span>
        </div>
        {readOnly ? null : (
          <div className="shared-actions">
            <Button
              icon="create"
              onClick={() => {
                onNavigate({ kind: "edit", rule });
              }}
            >
              Edit
            </Button>
            <Button
              icon={rule.active ? "pause" : "play"}
              busy={saving}
              onClick={() => {
                void toggle(rule);
              }}
            >
              {rule.active ? "Pause" : "Resume"}
            </Button>
          </div>
        )}

        <section className="schedule-detail__section" aria-labelledby={`${rule.id}-next`}>
          <h3 id={`${rule.id}-next`}>Next</h3>
          {rule.active ? (
            next.length ? (
              <ol className="schedule-dates">
                {next.map((date, index) => (
                  <li key={date}>
                    <time dateTime={date}>{dayLabel(date, date.slice(0, 4) !== today.slice(0, 4))}</time>
                    {index === 0 ? <span className="muted"> · {relativeDay(date, today)}</span> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="note">No more dates: the ledger ends on Dec 31, 2100.</p>
            )
          ) : (
            <p className="note">
              Paused: Penny records nothing and skips its dates. If you resume today it continues on <time dateTime={resumesOn}>{dayLabel(resumesOn, true)}</time>.
            </p>
          )}
        </section>

        <section className="schedule-detail__section" aria-labelledby={`${rule.id}-details`}>
          <h3 id={`${rule.id}-details`}>Details</h3>
          <dl className="detail-grid">
            <dt>Category</dt>
            <dd>{category?.name ?? "Removed category"}</dd>
            <dt>Account</dt>
            <dd>{account?.name ?? (rule.accountId ? "Removed account" : "None")}</dd>
            {rule.share !== rule.total ? (
              <>
                <dt>Total</dt>
                <dd>
                  <Money cents={rule.total} currency={ledger.currency} tone="muted" /> (your share <Money cents={rule.share} currency={ledger.currency} tone="muted" />)
                </dd>
              </>
            ) : null}
            <dt>Started</dt>
            <dd>
              <time dateTime={rule.date}>{dayLabel(rule.date, true)}</time>
            </dd>
            <dt>Recorded</dt>
            <dd>{recorded === 1 ? "1 entry" : `${String(recorded)} entries`} in your activity</dd>
            {rule.note ? (
              <>
                <dt>Note</dt>
                <dd>{rule.note}</dd>
              </>
            ) : null}
          </dl>
        </section>

        {readOnly ? null : (
          <div className="schedule-detail__remove">
            <Button
              variant="danger-quiet"
              icon="trash"
              onClick={() => {
                onNavigate({ kind: "remove", rule });
              }}
            >
              Remove schedule
            </Button>
            <span className="note">Past entries stay in your activity.</span>
          </div>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Remove confirmation (specimen `remove-schedule`): only the rule goes; the entries it recorded keep
 * their details. Keep schedule returns to the detail.
 */
export function RemoveScheduleDialog({ rule, onCancel, onRemoved }: { rule: Recurring; onCancel: () => void; onRemoved: () => void }) {
  const toast = useToast();
  const { save, saving, error } = useScheduleSave();
  async function confirm() {
    const receipt = await save(removeSchedule(rule.id));
    if (!receipt) return;
    toast.show({ title: `${rule.title} removed`, detail: savedDetail(receipt, "Entries it already recorded stay in your activity.") });
    onRemoved();
  }
  return (
    <Dialog
      title={`Remove ${rule.title}?`}
      description={`Penny stops recording it${rule.active ? ` from ${shortDay(rule.nextDate)}` : ""}. Entries it already recorded stay in your activity with their details.`}
      onClose={onCancel}
      actions={
        <>
          <Button variant="quiet" onClick={onCancel}>
            Keep schedule
          </Button>
          <Button
            variant="danger"
            busy={saving}
            onClick={() => {
              void confirm();
            }}
          >
            {saving ? "Removing…" : "Remove schedule"}
          </Button>
        </>
      }
    >
      {error ? <SaveErrorBanner message={error} /> : null}
    </Dialog>
  );
}
