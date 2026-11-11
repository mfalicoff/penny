import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { auditQuery } from "../../api/households";
import type { AuditEvent } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";
import { Avatar, Card, ChoiceGroup } from "../../design/controls";
import { EmptyState, ErrorState, LoadingState } from "../../design/states";
import type { HouseholdView } from "./context";
import { describeLoadError } from "./errors";
import { auditCategory, dayLabel, describeAudit, localDate, type AuditFilter } from "./model";

/**
 * History (card `iphone-history`): every change, by everyone, newest first, grouped by day.
 * With `expenseId`, one expense's history. Snapshots arrive without the payer's private account.
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

  const list = (
    <>
      {days.size === 0 ? <EmptyState icon="time" title="No changes to show" /> : null}
      {[...days].map(([day, items]) => (
        <section key={day} aria-labelledby={`day-${day}`}>
          <h3 id={`day-${day}`} className="history-day">
            {day === localDate() ? "Today" : dayLabel(day, true)}
          </h3>
          <ul className="row-list">
            {items.map((event) => {
              const { summary, changes } = describeAudit(event, view.who.name, view.money);
              return (
                <li key={event.id} className="row">
                  <Avatar name={view.who.name(event.actorId)} size={28} />
                  <span>
                    <span>{summary}</span>
                    {changes.map((change) => (
                      <span key={change} className="history-change">
                        {change}
                      </span>
                    ))}
                  </span>
                  <time className="row__meta" dateTime={new Date(event.createdAt).toISOString()}>
                    {new Date(event.createdAt).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })}
                  </time>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );

  if (expenseId) return <div className="shared-section">{list}</div>;
  return (
    <Card title="History">
      <p className="muted">{view.detail.household.name} · every change, by everyone</p>
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
      {list}
    </Card>
  );
}
