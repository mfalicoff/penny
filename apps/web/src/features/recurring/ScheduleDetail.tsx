import { removeSchedule, setScheduleActive } from "@domain/commands.ts";
import { dateKey, type Ledger, type Recurring } from "@domain/ledger.ts";
import { Badge, Button } from "../../design/controls";
import { Dialog } from "../../design/ModalDialog";
import { tileStyle } from "../../design/categoryTint";
import { Icon } from "../../design/Icon";
import { Money } from "../../design/Money";
import { SaveErrorBanner, useToast } from "../../design/states";
import { accountOf, cadenceLabel, categoryOf, dayLabel, relativeDay, resumeDate, rowAmount, scheduleTile, shortDay, TONE, upcomingDates, type ScheduleView } from "./model";
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
 * Schedule detail (card `iphone-schedule-detail`, specimen `schedule`): the category tile, the
 * signed amount and cadence, Edit (the copper primary) beside Pause or Resume, the next dates and
 * the details as solid groups, and Remove schedule, which asks first. It follows the live ledger,
 * so a sync or another tab updates it while it is open.
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
  const tile = scheduleTile(rule.kind, category);
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
    <Dialog title={rule.title} onClose={onClose} grouped>
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
          <span className="category-dot schedule-detail__tile" style={tile.style} aria-hidden="true">
            <Icon name={tile.icon} size={28} weight={40} />
          </span>
          <Money {...rowAmount(rule.kind, rule.share)} currency={ledger.currency} tone={TONE[rule.kind]} className="schedule-detail__amount" />
          <p className="schedule-detail__cadence">{cadenceLabel(rule)}</p>
          {!rule.active || waiting ? (
            <span className="schedule-detail__badges">
              {rule.active ? null : <Badge icon="pause">Paused</Badge>}
              {waiting ? <Badge tone="pending" icon="cloud-offline">Waiting to sync</Badge> : null}
            </span>
          ) : null}
        </div>
        {readOnly ? null : (
          <div className="schedule-detail__actions">
            <Button
              variant="primary"
              icon="create"
              onClick={() => {
                onNavigate({ kind: "edit", rule });
              }}
            >
              Edit
            </Button>
            <Button
              className="schedule-detail__solid"
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
          <h3 id={`${rule.id}-next`} className="group-label">
            Next
          </h3>
          {rule.active ? (
            next.length ? (
              <ol className="group-list schedule-dates">
                {next.map((date, index) => (
                  <li key={date}>
                    <time dateTime={date}>{dayLabel(date, date.slice(0, 4) !== today.slice(0, 4))}</time>
                    {index === 0 ? (
                      <span className="schedule-dates__when">
                        <span className="visually-hidden">, </span>
                        {relativeDay(date, today)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="group-note">No more dates: the ledger ends on Dec 31, 2100.</p>
            )
          ) : (
            <p className="group-list schedule-detail__paused">
              Paused: Penny records nothing and skips its dates. If you resume today it continues on <time dateTime={resumesOn}>{dayLabel(resumesOn, true)}</time>.
            </p>
          )}
        </section>

        <section className="schedule-detail__section" aria-labelledby={`${rule.id}-details`}>
          <h3 id={`${rule.id}-details`} className="group-label">
            Details
          </h3>
          <dl className="group-list schedule-facts">
            <div>
              <dt>Category</dt>
              <dd>
                {category ? <span className="schedule-facts__dot" style={tileStyle({ id: category.id, color: category.color })} aria-hidden="true" /> : null}
                {category?.name ?? "Removed category"}
              </dd>
            </div>
            <div>
              <dt>Account</dt>
              <dd>{account?.name ?? (rule.accountId ? "Removed account" : "None")}</dd>
            </div>
            {rule.share !== rule.total ? (
              <div>
                <dt>Total</dt>
                <dd>
                  <Money cents={rule.total} currency={ledger.currency} tone="muted" /> (your share <Money cents={rule.share} currency={ledger.currency} tone="muted" />)
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Started</dt>
              <dd>
                <time dateTime={rule.date}>{shortDay(rule.date)}, {rule.date.slice(0, 4)}</time>
              </dd>
            </div>
            {rule.note ? (
              <div>
                <dt>Note</dt>
                <dd>{rule.note}</dd>
              </div>
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
            <span className="group-note">Past entries stay in your activity.</span>
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
