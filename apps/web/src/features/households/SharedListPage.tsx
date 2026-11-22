import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { householdDetailQuery, householdsQuery, monthRecapQuery } from "../../api/households";
import type { Household } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";
import { useIsDemo } from "../../demo/demo";
import { Avatar } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { Money } from "../../design/Money";
import { EmptyState, ErrorState, LoadingState } from "../../design/states";
import { GroupToolbar, ToolButton } from "./GroupTools";
import { CreateHouseholdDialog, JoinHouseholdDialog } from "./StartDialogs";
import { describeLoadError } from "./errors";
import { currentMonth, findMe, isCurrent, monthLabel, shortRange } from "./model";
import { OnlineNotice } from "./OnlineNotice";

/**
 * Shared (card `iphone-shared-list`): this month's position across everything shared under the
 * title, then the households and trips the account belongs to, each with a tile, its members and
 * this month's balance, and the two ways in (join with a code, new household) as one list.
 */
export function SharedListPage() {
  const email = useAccountEmail();
  const demo = useIsDemo();
  // The demo lists its read-only sample household (MAZ-283), with no way to create or join one.
  const households = useQuery(householdsQuery(email));
  const [dialog, setDialog] = useState<"create" | "join" | null>(null);
  const all = households.data ?? [];
  const month = currentMonth();
  // Each row's balance needs the members (to find you) and this month's recap. The household page
  // reads the same queries, so opening one is instant. A failed row just shows no balance.
  const details = useQueries({ queries: all.map((household) => householdDetailQuery(email, household.id)) });
  const recaps = useQueries({ queries: all.map((household) => monthRecapQuery(email, household.id, month)) });
  const rows: GroupRow[] = all.map((household, index) => {
    const members = details[index]?.data?.members ?? [];
    const me = findMe(members, email);
    const recap = recaps[index]?.data;
    // A month with nothing shared has no row for you: you're settled there.
    const balance = me && recap ? (recap.balances.find((row) => row.userId === me.userId)?.balanceCents ?? 0) : undefined;
    return { household, members: members.filter(isCurrent).map((member) => member.email), balance };
  });

  const start = (
    <ul className="start-actions" aria-label="Start sharing">
      <li>
        <button type="button" className="start-action" onClick={() => { setDialog("join"); }}>
          <span className="start-action__tile">
            <Icon name="key" />
          </span>
          <span className="start-action__title">Join with a code</span>
          <span className="start-action__text">Someone shared an invite code with you</span>
        </button>
      </li>
      <li>
        <button type="button" className="start-action" onClick={() => { setDialog("create"); }}>
          <span className="start-action__tile">
            <Icon name="person-add" />
          </span>
          <span className="start-action__title">New household</span>
          <span className="start-action__text">Split rent, bills and groceries every month</span>
        </button>
      </li>
    </ul>
  );

  let body;
  if (households.isPending) body = <LoadingState label="Loading your households…" />;
  else if (households.isError && !households.data) {
    body = (
      <ErrorState title="Penny couldn't load your households" onRetry={() => void households.refetch()} retrying={households.isFetching}>
        {describeLoadError(households.error)}
      </ErrorState>
    );
  } else {
    const homes = rows.filter((row) => !row.household.trip);
    const trips = rows.filter((row) => row.household.trip);
    body = (
      <>
        <Overall rows={rows} month={month} />
        {all.length === 0 ? (
          <EmptyState icon="people" title="Nothing shared yet">
            <p>Create a household to split rent, bills and groceries, or join one with a code. Everyone sees the full expense; your reports count only your share.</p>
          </EmptyState>
        ) : null}
        {homes.length ? <GroupSection title="Households" rows={homes} /> : null}
        {trips.length ? <GroupSection title="Trips" rows={trips} /> : null}
      </>
    );
  }

  return (
    <div className="page shared-list">
      {demo ? null : (
        <GroupToolbar>
          <ToolButton icon="add" label="New household" onClick={() => { setDialog("create"); }} />
        </GroupToolbar>
      )}
      <OnlineNotice />
      {body}
      {households.isPending || demo ? null : start}
      {dialog === "create" ? <CreateHouseholdDialog onClose={() => { setDialog(null); }} /> : null}
      {dialog === "join" ? <JoinHouseholdDialog onClose={() => { setDialog(null); }} /> : null}
    </div>
  );
}

interface GroupRow {
  household: Household;
  /** Current members' emails, for the avatars. */
  members: string[];
  /** Your balance this month, once known. */
  balance: number | undefined;
}

/**
 * The title's subtitle: your position this month across every household and trip ("November ·
 * you're owed $104.30 overall"), once every balance is known and they share one currency.
 */
function Overall({ rows, month }: { rows: GroupRow[]; month: string }) {
  const currencies = new Set(rows.map((row) => row.household.currency));
  if (!rows.length || currencies.size !== 1 || rows.some((row) => row.balance === undefined)) return null;
  const total = rows.reduce((sum, row) => sum + (row.balance ?? 0), 0);
  const currency = rows[0]?.household.currency;
  const name = monthLabel(month).split(" ")[0];
  return (
    <p className="shared-overall">
      {name} ·{" "}
      {total > 0 ? (
        <>
          you're owed <Money cents={total} currency={currency} tone="income" /> overall
        </>
      ) : total < 0 ? (
        <>
          you owe <Money cents={-total} currency={currency} /> overall
        </>
      ) : (
        "you're settled everywhere"
      )}
    </p>
  );
}

function GroupSection({ title, rows }: { title: string; rows: GroupRow[] }) {
  const headingId = `shared-${title.toLowerCase()}`;
  return (
    <section className="shared-section" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      <ul className="shared-groups">
        {rows.map(({ household, members, balance }) => (
          <li key={household.id}>
            <Link to={household.trip ? "/trips/$id" : "/households/$id"} params={{ id: household.id }} className="group-row">
              <span className="group-row__tile" aria-hidden="true">
                <Icon name={household.trip ? "airplane" : "home"} size={24} />
              </span>
              <span className="group-row__main">
                <span className="group-row__name">{household.name}</span>
                <span className="group-row__meta">
                  <span className="avatars" aria-hidden="true">
                    {members.slice(0, 4).map((member) => (
                      <Avatar key={member} name={member} size={26} />
                    ))}
                  </span>
                  {household.trip ? shortRange(household.trip.startDate, household.trip.endDate) : `${String(household.memberCount)} ${household.memberCount === 1 ? "member" : "members"}`}
                </span>
              </span>
              <GroupBalance balance={balance} currency={household.currency} />
              <Icon name="chevron-forward" size={16} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** This month's balance at the row's end: owed to you in income green, owing in the label color, or Settled. */
function GroupBalance({ balance, currency }: { balance: number | undefined; currency: string }) {
  if (balance === undefined) return <span className="group-row__balance" />;
  if (balance === 0) {
    return (
      <span className="group-row__balance group-row__balance--settled">
        <Icon name="checkmark-circle" size={16} />
        Settled
      </span>
    );
  }
  return (
    <span className="group-row__balance">
      {balance > 0 ? "you're owed" : "you owe"}
      <Money cents={Math.abs(balance)} currency={currency} tone={balance > 0 ? "income" : "expense"} />
    </span>
  );
}
