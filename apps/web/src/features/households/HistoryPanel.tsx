import { useQuery } from "@tanstack/react-query";
import { Fragment, useState, type ReactNode } from "react";
import { auditQuery } from "../../api/households";
import type { AuditEvent } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";
import { Avatar, ChoiceGroup, cx } from "../../design/controls";
import { Icon, type IconName } from "../../design/Icon";
import { EmptyState, ErrorState, LoadingState } from "../../design/states";
import type { HouseholdView } from "./context";
import { describeLoadError } from "./errors";
import { auditCategory, dayLabel, describeAudit, localDate, type AuditFilter } from "./model";

/** The small badge on the actor's avatar: what kind of change it was (card `iphone-history`). */
function actionBadge(action: string, automatic: boolean): { icon: IconName; tone: "neutral" | "income" } {
  if (automatic) return { icon: "repeat", tone: "neutral" };
  if (action.startsWith("reimbursement")) return { icon: "checkmark", tone: "income" };
  if (action.startsWith("member") || action.startsWith("invite")) return { icon: "person-add", tone: "neutral" };
  if (action.startsWith("recurring")) return { icon: "repeat", tone: "neutral" };
  if (action.endsWith("created")) return { icon: "add", tone: "neutral" };
  if (action.endsWith("deleted") || action.endsWith("archived")) return { icon: "trash", tone: "neutral" };
  return { icon: "create", tone: "neutral" };
}

/** The sentence with the actor and the subject in bold, as on the card. */
function emphasize(summary: string, names: string[]): ReactNode {
  const parts: ReactNode[] = [];
  let rest = summary;
  for (const name of names) {
    const at = rest.indexOf(name);
    if (at < 0 || !name) continue;
    parts.push(rest.slice(0, at), <strong key={parts.length}>{name}</strong>);
    rest = rest.slice(at + name.length);
  }
  parts.push(rest);
  return parts.map((part, index) => <Fragment key={index}>{part}</Fragment>);
}

/** "Today", "Sat, Nov 7", or with the year when it isn't this year's (uppercase on screen). */
function dayHeading(day: string): string {
  if (day === localDate()) return "Today";
  return dayLabel(day, day.slice(0, 4) !== localDate().slice(0, 4));
}

/**
 * History (card `iphone-history`): every change, by everyone, newest first, with filter chips and
 * a card per day. Each row has the actor's avatar with a badge for the kind of change, the
 * sentence with the actor and subject in bold, what changed (old values struck through) and the
 * time. With `expenseId`, one expense's history. Snapshots arrive without the payer's private
 * account.
 */
export function HistoryPanel({ view, expenseId }: { view: HouseholdView; expenseId?: string }) {
  const email = useAccountEmail();
  const events = useQuery(auditQuery(email, view.householdId, expenseId));
  const [filter, setFilter] = useState<AuditFilter>("all");

  if (events.isPending) return <LoadingState label="Loading history…" />;
  if (events.isError) {
    return (
      <ErrorState title="Penny couldn't load the history" onRetry={() => void events.refetch()} retrying={events.isFetching}>
        {describeLoadError(events.error)}
      </ErrorState>
    );
  }
  const visible = events.data.filter((event) => filter === "all" || auditCategory(event.action) === filter);
  const days = new Map<string, AuditEvent[]>();
  for (const event of visible) {
    const day = localDate(new Date(event.createdAt));
    days.set(day, [...(days.get(day) ?? []), event]);
  }
  const group = view.detail.household.trip ? "trip" : "household";

  const list = (
    <>
      {days.size === 0 ? <EmptyState icon="time" title="No changes to show" /> : null}
      {[...days].map(([day, items]) => (
        <section key={day} className="shared-group" aria-labelledby={`day-${day}`}>
          <div className="shared-group__head">
            <h3 id={`day-${day}`}>{dayHeading(day)}</h3>
          </div>
          <ul className="shared-group__rows">
            {items.map((event) => {
              const { summary, changes, edits, emphasis } = describeAudit(event, view.who.name, view.money, group);
              const after = event.after && typeof event.after === "object" ? (event.after as Record<string, unknown>) : {};
              const badge = actionBadge(event.action, event.action === "expense.created" && Boolean(after.recurringId));
              return (
                <li key={event.id} className="history-row">
                  <span className="history-row__who" aria-hidden="true">
                    <Avatar name={view.who.avatar(event.actorId)} size={36} />
                    <span className={cx("history-row__badge", badge.tone === "income" && "history-row__badge--income")}>
                      <Icon name={badge.icon} size={11} weight={56} />
                    </span>
                  </span>
                  <span className="history-row__text">
                    <span>{emphasize(summary, emphasis)}</span>
                    {edits.length
                      ? edits.map((edit) => (
                          <span key={edit.label} className="history-change">
                            {edit.label}{" "}
                            <s>
                              <span className="visually-hidden">was </span>
                              {edit.before}
                            </s>{" "}
                            → {edit.after}
                          </span>
                        ))
                      : changes.map((change) => (
                          <span key={change} className="history-change">
                            {change}
                          </span>
                        ))}
                  </span>
                  <time className="history-row__time" dateTime={new Date(event.createdAt).toISOString()}>
                    {new Date(event.createdAt).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", hourCycle: "h23" })}
                  </time>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );

  if (expenseId) return <div className="shared-section history">{list}</div>;
  return (
    <section className="page history" aria-label="History">
      <p className="history__intro">{view.detail.household.name} · every change, by everyone</p>
      <div className="history__filters">
        <ChoiceGroup<AuditFilter>
          legend="Show"
          hideLegend
          name="history-filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "expenses", label: "Expenses" },
            { value: "payments", label: "Payments" },
            { value: "members", label: "Members" },
          ]}
        />
      </div>
      {list}
    </section>
  );
}
