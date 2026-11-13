import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { householdDetailQuery, householdsQuery, monthRecapQuery } from "../../api/households";
import type { Household } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";
import { useIsDemo } from "../../demo/demo";
import { Avatar, Badge } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { Money } from "../../design/Money";
import { EmptyState, ErrorState, LoadingState } from "../../design/states";
import { CreateHouseholdDialog, JoinHouseholdDialog } from "./StartDialogs";
import { describeLoadError } from "./errors";
import { currentMonth, dayLabel, findMe, isCurrent, monthLabel } from "./model";
import { OnlineNotice } from "./OnlineNotice";

/**
 * Shared (card `iphone-shared-list`): households and shared trips the account belongs to, with
 * this month's balance for each, and the two ways in: join with a code or create a household.
 */
export function SharedListPage() {
  const email = useAccountEmail();
  const demo = useIsDemo();
  const households = useQuery({ ...householdsQuery(email), enabled: !demo });
  const [dialog, setDialog] = useState<"create" | "join" | null>(null);

  const start = (
    <div className="start-actions">
      <button type="button" className="start-action" onClick={() => { setDialog("join"); }}>
        <Icon name="key" />
        <span className="start-action__title">Join with a code</span>
        <span className="muted">Someone shared an invite code with you</span>
      </button>
      <button type="button" className="start-action" onClick={() => { setDialog("create"); }}>
        <Icon name="add" />
        <span className="start-action__title">New household</span>
        <span className="muted">Split rent, bills and groceries every month</span>
      </button>
    </div>
  );

  let body;
  if (demo) {
    body = (
      <EmptyState icon="people" title="The demo has no shared households">
        <p>Sign in to your own Penny server to share one. Nothing was changed.</p>
      </EmptyState>
    );
  } else if (households.isPending) body = <LoadingState label="Loading your households…" />;
  else if (households.isError && !households.data) {
    body = (
      <ErrorState title="Penny couldn't load your households" onRetry={() => void households.refetch()} retrying={households.isFetching}>
        {describeLoadError(households.error)}
      </ErrorState>
    );
  } else {
    const all = households.data;
    const homes = all.filter((household) => !household.trip);
    const trips = all.filter((household) => household.trip);
    body = (
      <>
        {all.length === 0 ? (
          <EmptyState icon="people" title="Nothing shared yet">
            <p>Create a household to split rent, bills and groceries, or join one with a code. Everyone sees the full expense; your reports count only your share.</p>
          </EmptyState>
        ) : null}
        {homes.length ? <GroupSection title="Households" households={homes} /> : null}
        {trips.length ? <GroupSection title="Shared trips" households={trips} /> : null}
      </>
    );
  }

  return (
    <div className="page">
      <OnlineNotice />
      {body}
      {households.isPending ? null : start}
      {dialog === "create" ? <CreateHouseholdDialog onClose={() => { setDialog(null); }} /> : null}
      {dialog === "join" ? <JoinHouseholdDialog onClose={() => { setDialog(null); }} /> : null}
    </div>
  );
}

function GroupSection({ title, households }: { title: string; households: Household[] }) {
  const email = useAccountEmail();
  const month = currentMonth();
  // Each row's balance needs the members (to find you) and this month's recap. The household page
  // reads the same queries, so opening one is instant. A failed row just shows no balance.
  const details = useQueries({ queries: households.map((household) => householdDetailQuery(email, household.id)) });
  const recaps = useQueries({ queries: households.map((household) => monthRecapQuery(email, household.id, month)) });
  return (
    <section className="shared-section" aria-labelledby={`shared-${title}`}>
      <h2 id={`shared-${title}`}>{title}</h2>
      <ul className="group-list">
        {households.map((household, index) => {
          const members = details[index]?.data?.members.filter(isCurrent) ?? [];
          const me = findMe(details[index]?.data?.members ?? [], email);
          const balance = me ? recaps[index]?.data?.balances.find((row) => row.userId === me.userId)?.balanceCents : undefined;
          const overdue = (recaps[index]?.data?.overdueMonths.length ?? 0) > 0;
          return (
            <li key={household.id}>
              <Link to="/households/$id" params={{ id: household.id }} className="group-row">
                <span>
                  <span className="group-row__name">{household.name}</span>
                  <span className="group-row__meta">
                    {" "}
                    · {household.memberCount} {household.memberCount === 1 ? "member" : "members"}
                    {household.trip ? ` · ${dayLabel(household.trip.startDate)} – ${dayLabel(household.trip.endDate, true)}` : ""}
                  </span>
                  <span className="group-row__meta" style={{ display: "block" }}>
                    {balance === undefined ? (
                      household.currency
                    ) : balance > 0 ? (
                      <>
                        {monthLabel(month).split(" ")[0]} · you're owed <Money cents={balance} currency={household.currency} tone="income" />
                      </>
                    ) : balance < 0 ? (
                      <>
                        {monthLabel(month).split(" ")[0]} · you owe <Money cents={-balance} currency={household.currency} />
                      </>
                    ) : (
                      `${monthLabel(month).split(" ")[0]} · settled`
                    )}
                  </span>
                </span>
                <span className="avatars" aria-hidden="true">
                  {members.slice(0, 4).map((member) => (
                    <Avatar key={member.userId} name={member.email} size={28} />
                  ))}
                </span>
                {overdue ? (
                  <Badge tone="danger" icon="alert-circle">
                    Overdue
                  </Badge>
                ) : (
                  <Icon name="chevron-forward" size={16} />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
