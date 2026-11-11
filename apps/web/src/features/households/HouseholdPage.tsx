import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { householdDetailQuery, householdsQuery, monthRecapQuery } from "../../api/households";
import { useAccountEmail } from "../../auth/account";
import { usePageTitle } from "../../app/shell/pageTitle";
import { Avatar, Badge, Button } from "../../design/controls";
import { Money } from "../../design/Money";
import { Icon } from "../../design/Icon";
import { Banner, ErrorState, LoadingState } from "../../design/states";
import { BalancesTab } from "./BalancesTab";
import { householdView, type HouseholdView } from "./context";
import { describeLoadError } from "./errors";
import { ExpenseDetailDialog } from "./ExpenseDetail";
import { ExpenseFormDialog, type FormTarget } from "./ExpenseForm";
import { ExpensesTab } from "./ExpensesTab";
import { HistoryPanel } from "./HistoryPanel";
import { currentMonth, dayLabel, isCurrent, monthLabel, people, shiftMonth } from "./model";
import { OnlineNotice } from "./OnlineNotice";
import { PeopleTab } from "./PeopleTab";
import type { HouseholdSearch, HouseholdTab } from "./search";

const TAB_LABEL: Record<Exclude<HouseholdTab, "history">, string> = { expenses: "Expenses", balances: "Balances", people: "People" };

/**
 * A household (cards `web-household`, `iphone-shared`, `ipad-shared`): members and your balance
 * for the month, then Expenses, Balances and People. `expenseId` opens that expense in the detail
 * panel (legacy `/households/$id/expenses/$expenseId`).
 */
export function HouseholdPage({ householdId, expenseId, search }: { householdId: string; expenseId?: string; search: HouseholdSearch }) {
  const email = useAccountEmail();
  const navigate = useNavigate();
  const month = search.month ?? currentMonth();
  const tab: HouseholdTab = search.tab ?? "expenses";
  const detail = useQuery(householdDetailQuery(email, householdId));
  const list = useQuery(householdsQuery(email));
  const recap = useQuery({ ...monthRecapQuery(email, householdId, month), enabled: detail.isSuccess });
  const [form, setForm] = useState<FormTarget | null>(search.add ? { kind: "new" } : null);
  usePageTitle(detail.data?.household.name);

  // A legacy `?add=1` link opens the form once; drop it from the URL so Back and reload don't reopen it.
  const consumedAdd = useRef(false);
  useEffect(() => {
    if (!search.add || consumedAdd.current) return;
    consumedAdd.current = true;
    void navigate({ to: ".", search: { ...search, add: undefined }, replace: true });
  }, [search, navigate]);

  if (detail.isPending) return <LoadingState label="Loading the household…" />;
  if (detail.isError) {
    return (
      <div className="page">
        <ErrorState title="Penny couldn't open this household" onRetry={() => void detail.refetch()} retrying={detail.isFetching}>
          {describeLoadError(detail.error)}
        </ErrorState>
        <Link to="/households" className="wbtn wbtn--secondary" style={{ justifySelf: "center" }}>
          All shared
        </Link>
      </div>
    );
  }

  const who = people(detail.data, email);
  // The list leaves out archived households; former members still see theirs until archived.
  const archived = list.isSuccess && !list.data.some((household) => household.id === householdId);
  const view = householdView(householdId, detail.data, who, month, archived);
  const { household } = detail.data;
  const current = detail.data.members.filter(isCurrent);
  const balance = who.meId ? recap.data?.balances.find((row) => row.userId === who.meId)?.balanceCents : undefined;
  const linkSearch = (next: Partial<HouseholdSearch>) => ({ ...search, add: undefined, ...next });

  return (
    <div className="page">
      <OnlineNotice />
      <section className="household-head" aria-label="Household summary">
        <span className="avatars" aria-hidden="true">
          {current.slice(0, 5).map((member) => (
            <Avatar key={member.userId} name={member.email} size={40} />
          ))}
        </span>
        <div className="household-head__summary">
          <span className="muted">
            {household.trip ? `${dayLabel(household.trip.startDate)} – ${dayLabel(household.trip.endDate, true)} · ` : ""}
            {current.length} {current.length === 1 ? "member" : "members"} · {household.currency}
            {archived ? (
              <>
                {" "}
                <Badge>Archived</Badge>
              </>
            ) : null}
          </span>
          <p className="household-head__balance" aria-live="polite">
            <MonthBalance month={month} balance={balance} loading={recap.isPending} view={view} />
          </p>
        </div>
        <div className="shared-actions">
          {view.canWrite ? (
            <Button variant="primary" icon="add" onClick={() => { setForm({ kind: "new" }); }}>
              Shared expense
            </Button>
          ) : null}
          {view.canWrite && view.creator ? (
            <Link to="/households/$id" params={{ id: householdId }} search={linkSearch({ tab: "people" })} className="wbtn wbtn--secondary">
              Invite
            </Link>
          ) : null}
          <Link
            to="/households/$id"
            params={{ id: householdId }}
            search={linkSearch({ tab: "history" })}
            className="wbtn wbtn--quiet"
            aria-current={tab === "history" ? "page" : undefined}
          >
            History
          </Link>
        </div>
      </section>

      {archived ? (
        <Banner tone="info" title="This household is archived">
          Its expenses, balances and history stay readable. Nothing in it can change.
        </Banner>
      ) : who.meId && !who.isCurrentMember(who.meId) ? (
        <Banner tone="info" title="You left this household">
          You can still see your own history here, but you can't add or change anything.
        </Banner>
      ) : null}

      <nav className="month-nav" aria-label="Month">
        <Link to="/households/$id" params={{ id: householdId }} search={linkSearch({ month: shiftMonth(month, -1) })} className="wbtn wbtn--quiet wbtn--icon" aria-label="Previous month">
          <Icon name="chevron-back" size={16} />
        </Link>
        <span className="month-nav__label" aria-live="polite">
          {monthLabel(month)}
        </span>
        <Link to="/households/$id" params={{ id: householdId }} search={linkSearch({ month: shiftMonth(month, 1) })} className="wbtn wbtn--quiet wbtn--icon" aria-label="Next month">
          <Icon name="chevron-forward" size={16} />
        </Link>
        {month !== currentMonth() ? (
          <Link to="/households/$id" params={{ id: householdId }} search={linkSearch({ month: undefined })} className="wbtn wbtn--quiet">
            This month
          </Link>
        ) : null}
      </nav>

      <nav className="section-tabs" aria-label="Household sections">
        {(Object.keys(TAB_LABEL) as (keyof typeof TAB_LABEL)[]).map((key) => (
          <Link
            key={key}
            to="/households/$id"
            params={{ id: householdId }}
            search={linkSearch({ tab: key === "expenses" ? undefined : key })}
            aria-current={tab === key ? "page" : undefined}
            activeOptions={{ exact: true, includeSearch: true }}
          >
            {TAB_LABEL[key]}
          </Link>
        ))}
      </nav>

      {tab === "expenses" ? (
        <ExpensesTab view={view} recap={recap} search={linkSearch({})} onEditRule={(rule) => { setForm({ kind: "rule", rule }); }} />
      ) : tab === "balances" ? (
        <BalancesTab view={view} recap={recap} />
      ) : tab === "people" ? (
        <PeopleTab view={view} recap={recap.data} />
      ) : (
        <HistoryPanel view={view} />
      )}

      {expenseId ? (
        <ExpenseDetailDialog
          view={view}
          expenseId={expenseId}
          onEdit={(expense) => { setForm({ kind: "edit", expense }); }}
          onClose={() => void navigate({ to: "/households/$id", params: { id: householdId }, search: linkSearch({}) })}
        />
      ) : null}
      {form ? <ExpenseFormDialog view={view} target={form} onClose={() => { setForm(null); }} /> : null}
    </div>
  );
}

function MonthBalance({ month, balance, loading, view }: { month: string; balance: number | undefined; loading: boolean; view: HouseholdView }) {
  const name = monthLabel(month).split(" ")[0] ?? month;
  if (loading) return <>{name} · loading your balance…</>;
  if (balance === undefined) return <>{name} · nothing shared with you</>;
  if (balance > 0) {
    return (
      <>
        {name} · you're owed <Money cents={balance} currency={view.currency} tone="income" />
      </>
    );
  }
  if (balance < 0) {
    return (
      <>
        {name} · you owe <Money cents={-balance} currency={view.currency} />
      </>
    );
  }
  return (
    <>
      {name} · you're settled <Money cents={0} currency={view.currency} />
    </>
  );
}

