import { AddEntryDialog } from "../entries/AddEntryDialog";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { householdDetailQuery, householdsQuery, monthRecapQuery } from "../../api/households";
import { useEmailEnabled } from "../../api/info";
import type { HouseholdDetail, MonthRecap } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";
import { usePageTitle, usePageTitleStyle } from "../../app/shell/pageTitle";
import { TOUCH_TABLET, useMediaQuery, WIDE } from "../../app/useMediaQuery";
import { Avatar, Badge, cx } from "../../design/controls";
import { Money } from "../../design/Money";
import { Icon } from "../../design/Icon";
import { Banner, ErrorState, LoadingState } from "../../design/states";
import { MonthBarControls } from "../home/parts";
import { BalancesTab } from "./BalancesTab";
import { householdView, type HouseholdView } from "./context";
import { describeLoadError } from "./errors";
import { ExpenseDetailDialog } from "./ExpenseDetail";
import { ExpenseFormDialog, type FormTarget } from "./ExpenseForm";
import { ExpensesTab } from "./ExpensesTab";
import { GroupToolbar, MoreMenu, ToolButton, ToolContent, toolClass, type MoreItem } from "./GroupTools";
import { HistoryPanel } from "./HistoryPanel";
import { InviteEmailDialog } from "./InviteEmailDialog";
import { byWeek, currentMonth, isCurrent, memberName, monthLabel, people } from "./model";
import { OnlineNotice } from "./OnlineNotice";
import { PeopleTab, useManageActions } from "./PeopleTab";
import { RuleDialog } from "./RuleDialog";
import { usePeriodSlide } from "../../design/motion";
import type { HouseholdSearch, HouseholdTab } from "./search";

/**
 * The expense the touch-tablet pane last picked by itself (`ipad-shared`). Picking one changes the
 * route, which mounts the page again, so it lives here: that expense opens without taking focus.
 */
let autoPicked: string | undefined;

const TAB_LABEL: Record<Exclude<HouseholdTab, "history">, string> = { expenses: "Expenses", balances: "Balances", people: "People" };

/**
 * A household (cards `web-household`, `iphone-shared`, `ipad-shared`, `iphone-shared-balances`,
 * `iphone-shared-people`, `iphone-history`). Expenses leads with a centered hero: the members, the
 * name (the bar's title stays for screen readers on phones), this month's balance, Record payment
 * and + Expense, then the sections. Balances and People collapse to a navigation bar with the name
 * small and centered; History is titled History. The bar holds the month, Invite or History and
 * the … menu (Manage); from 1100px it holds History, Invite and Shared expense, as on
 * `web-household`, and Expenses is two panes: the expense table, and the selected expense with
 * Balances beside it. On a touch tablet from 1100px (`ipad-shared`) the hero splits across the two
 * panes: the name, the members and the month's total over the expenses, and the viewer's balance
 * over Balances and the selected expense, with + Expense in the bar. `expenseId` opens that
 * expense (`/households/$id/expenses/$expenseId`);
 * `?rule=` opens a repeating expense.
 */
export function HouseholdPage({ householdId, expenseId, search }: { householdId: string; expenseId?: string; search: HouseholdSearch }) {
  const email = useAccountEmail();
  const month = search.month ?? currentMonth();
  const tab: HouseholdTab = search.tab ?? "expenses";
  const detail = useQuery(householdDetailQuery(email, householdId));
  const list = useQuery(householdsQuery(email));
  const recap = useQuery({ ...monthRecapQuery(email, householdId, month), enabled: detail.isSuccess });
  usePageTitle(tab === "history" ? "History" : detail.data?.household.name);
  usePageTitleStyle(tab === "expenses" ? "hero" : tab === "history" ? "large" : "inline");

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
  // The list leaves out archived households; former members still see theirs until archived.
  const archived = list.isSuccess && !list.data.some((household) => household.id === householdId);
  return <HouseholdScreen householdId={householdId} expenseId={expenseId} search={search} detail={detail.data} archived={archived} recap={recap} month={month} tab={tab} />;
}

interface ScreenProps {
  householdId: string;
  expenseId: string | undefined;
  search: HouseholdSearch;
  detail: HouseholdDetail;
  archived: boolean;
  recap: UseQueryResult<MonthRecap>;
  month: string;
  tab: HouseholdTab;
}

function HouseholdScreen({ householdId, expenseId, search, detail, archived, recap, month, tab }: ScreenProps) {
  const email = useAccountEmail();
  const navigate = useNavigate();
  const wide = useMediaQuery(WIDE);
  const touch = useMediaQuery(TOUCH_TABLET);
  const [form, setForm] = useState<FormTarget | null>(null);
  const emailEnabled = useEmailEnabled();
  const [inviting, setInviting] = useState(false);
  const recordHintId = useId();
  // docs/design/motion.md, Month and period changes.
  const content = useRef<HTMLDivElement>(null);
  usePeriodSlide(content, month);
  const who = people(detail, email);
  const view = householdView(householdId, detail, who, month, archived);
  const manage = useManageActions(view, recap.data);
  const { household } = detail;
  const current = detail.members.filter(isCurrent);
  const balance = who.meId ? recap.data?.balances.find((row) => row.userId === who.meId)?.balanceCents : undefined;
  // `rule` is one-off: links to a section or month leave it out.
  const linkSearch = (next: Partial<HouseholdSearch>): HouseholdSearch => ({ month: search.month, tab: search.tab, ...next });
  const go = (next: Partial<HouseholdSearch>) => void navigate({ to: "/households/$id", params: { id: householdId }, search: linkSearch(next) });
  const closeRule = () => void navigate({ to: ".", search: linkSearch({}), replace: true });
  // From 1100px the selected expense sits beside the expenses instead of over them.
  const inlineExpense = wide && tab === "expenses";
  // `ipad-shared`: a touch tablet splits the hero across the two panes instead of one above both.
  const split = inlineExpense && touch;
  // The pane always shows an expense, as `ipad-activity` always shows an entry: the first listed
  // one when the household opens, and again when the selected one leaves the list (deleted, or
  // another month chosen). An expense opened from elsewhere (Activity, Home) stays open even when
  // it's from another month.
  const listed = split && recap.data?.month === month ? byWeek(recap.data.expenses).flatMap((group) => group.expenses.map((expense) => expense.id)) : undefined;
  const listedKey = listed?.join(",");
  const previousList = useRef<{ month: string; ids: string[] } | null>(null);
  useEffect(() => {
    if (listedKey === undefined) return;
    const ids = listedKey ? listedKey.split(",") : [];
    const before = previousList.current;
    previousList.current = { month, ids };
    if (expenseId !== undefined) {
      if (ids.includes(expenseId)) return;
      const left = before !== null && (before.month !== month || before.ids.includes(expenseId));
      if (!left) return;
    }
    const first = ids[0];
    autoPicked = first;
    const keep = { month: search.month };
    if (first) void navigate({ to: "/households/$id/expenses/$expenseId", params: { id: householdId, expenseId: first }, search: keep, replace: true });
    else if (expenseId !== undefined) void navigate({ to: "/households/$id", params: { id: householdId }, search: keep, replace: true });
  }, [listedKey, month, search.month, expenseId, householdId, navigate]);
  const monthName = monthLabel(month).split(" ")[0] ?? month;
  const monthTotal = recap.data?.expenses.reduce((sum, expense) => sum + expense.totalCents, 0);
  // Shared pages wear the green shared tint whatever the balance (`web-household`, `web-shared-expense`).
  const glow = <div className="glow glow--green" aria-hidden="true" />;
  const balanceLine = (className: string) => (
    <p className={className} aria-live="polite">
      <MonthBalance month={month} balance={balance} loading={recap.isPending} view={view} />
    </p>
  );
  const expenseDetail = expenseId ? (
    <ExpenseDetailDialog
      view={view}
      expenseId={expenseId}
      variant={inlineExpense ? "panel" : "dialog"}
      compact={split}
      focusOnOpen={(id) => id !== autoPicked}
      onEdit={(expense) => { setForm({ kind: "edit", expense }); }}
      onRule={(rule) => { go({ rule }); }}
      onClose={() => { go({}); }}
    />
  ) : null;
  // Phones and tablets: Expenses shows Invite, the other sections History (cards `iphone-shared`,
  // `iphone-shared-balances`, `iphone-shared-people`); the rest is in the … menu.
  const historyInBar = wide || tab !== "expenses";
  const inviteInBar = view.canWrite && view.creator && (wide || tab === "expenses");
  const more: MoreItem[] = [...(historyInBar ? [] : [{ label: "History", icon: "time" as const, onSelect: () => { go({ tab: "history" }); } }]), ...manage.items];

  const sections = (
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
  );

  return (
    <div ref={content} className={cx("page household", split && "household--split")}>
      <GroupToolbar ownAdd lead={tab === "expenses" || tab === "balances" ? <MonthBarControls month={month} onChange={(next) => { go({ month: next }); }} /> : null}>
        {historyInBar ? (
          <Link to="/households/$id" params={{ id: householdId }} search={linkSearch({ tab: "history" })} className={toolClass()} aria-current={tab === "history" ? "page" : undefined}>
            <ToolContent icon="time" label="History" />
          </Link>
        ) : null}
        {inviteInBar && emailEnabled ? (
          // MAZ-124: with email on the server, Invite opens Invite by email (card `web-invite-email`).
          <ToolButton icon="person-add" label="Invite" labelled onClick={() => { setInviting(true); }} />
        ) : inviteInBar ? (
          <Link to="/households/$id" params={{ id: householdId }} search={linkSearch({ tab: "people" })} className={toolClass({ labelled: true })}>
            <ToolContent icon="person-add" label="Invite" labelled />
          </Link>
        ) : null}
        {wide ? null : <MoreMenu items={more} label="Household actions" />}
        {view.canWrite && wide ? (
          // The iPad card's capsule reads "+ Expense"; its name says what it adds.
          <ToolButton primary icon="add" label="Shared expense" text={touch ? "Expense" : undefined} onClick={() => { setForm({ kind: "new" }); }} />
        ) : null}
      </GroupToolbar>
      <OnlineNotice />
      {tab === "expenses" && !split ? (
        <section className="household-head" aria-label="Household summary">
          {glow}
          <span className="avatars household-head__people" aria-hidden="true">
            {current.slice(0, 5).map((member) => (
              <Avatar key={member.userId} name={memberName(member)} src={member.avatarUrl} size={44} />
            ))}
          </span>
          <div className="household-head__summary">
            {/* The bar's title is the page's heading; on phones it's only for screen readers, so the hero shows the name. */}
            <p className="household-head__name" aria-hidden="true">
              {household.name}
            </p>
            {archived ? <Badge>Archived</Badge> : null}
            {balanceLine("household-head__balance")}
          </div>
          {view.canWrite && !wide ? (
            <div className="household-head__actions">
              <Link to="/households/$id" params={{ id: householdId }} search={linkSearch({ tab: "balances" })} className="wbtn wbtn--primary household-head__action" aria-describedby={recordHintId}>
                <Icon name="checkmark-circle" size={19} />
                Record payment
              </Link>
              {/* The card reads "+ Expense"; its name says what it adds. */}
              <button type="button" className="wbtn household-head__action glass" aria-label="Shared expense" onClick={() => { setForm({ kind: "new" }); }}>
                <Icon name="add" size={18} weight={44} />
                Expense
              </button>
              <span id={recordHintId} className="visually-hidden">
                Shows balances and suggested payments to record
              </span>
            </div>
          ) : null}
          {sections}
        </section>
      ) : null}

      {archived ? (
        <Banner tone="info" title="This household is archived">
          Its expenses, balances and history stay readable. Nothing in it can change.
        </Banner>
      ) : who.meId && !who.isCurrentMember(who.meId) ? (
        <Banner tone="info" title="You left this household">
          You can still see your own history here, but you can't add or change anything.
        </Banner>
      ) : null}

      {tab === "expenses" ? null : sections}

      {tab === "expenses" ? (
        <ExpensesTab
          view={view}
          recap={recap}
          selectedId={expenseId}
          search={linkSearch({})}
          lead={
            split ? (
              <section className="household-pane-head" aria-label="Household summary">
                <div className="household-pane-head__top">
                  {/* The bar's title is the page's heading, for screen readers only here; the pane shows the name. */}
                  <p className="household-pane-head__name" aria-hidden="true">
                    {household.name}
                  </p>
                  <span className="avatars household-pane-head__people" aria-hidden="true">
                    {current.slice(0, 5).map((member) => (
                      <Avatar key={member.userId} name={memberName(member)} src={member.avatarUrl} size={30} />
                    ))}
                  </span>
                </div>
                {archived ? <Badge>Archived</Badge> : null}
                <p className="household-pane-head__total">
                  {monthName} · {monthTotal === undefined ? "loading the month's total…" : <>{view.money(monthTotal)} in shared expenses</>}
                </p>
                {sections}
              </section>
            ) : undefined
          }
          side={
            split ? (
              <>
                {glow}
                {balanceLine("household-head__balance household-owed")}
                <BalancesTab view={view} recap={recap} compact />
                {expenseDetail}
              </>
            ) : wide ? (
              <>
                {expenseDetail}
                <BalancesTab view={view} recap={recap} compact brief={Boolean(expenseDetail)} />
              </>
            ) : undefined
          }
        />
      ) : tab === "balances" ? (
        <BalancesTab view={view} recap={recap} />
      ) : tab === "people" ? (
        <PeopleTab view={view} recap={recap.data} manage={wide} />
      ) : (
        <HistoryPanel view={view} />
      )}

      {wide ? null : manage.dialogs}
      {inviting && emailEnabled ? <InviteEmailDialog view={view} onClose={() => { setInviting(false); }} /> : null}
      {inlineExpense ? null : expenseDetail}
      {search.rule && !form ? <RuleDialog view={view} ruleId={search.rule} onEdit={(rule) => { setForm({ kind: "rule", rule }); }} onClose={closeRule} /> : null}
      {form?.kind === "new" ? (
        <AddEntryDialog householdId={view.householdId} onClose={() => { setForm(null); }} />
      ) : form ? (
        <ExpenseFormDialog
          view={view}
          target={form}
          onClose={() => {
            if (form.kind === "rule") closeRule();
            setForm(null);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The viewer's balance for the month, in words and its meaning color (design baseline
 * `colors.meaning`): owed to you is income green, owing is an expense in the label color (never
 * red), settled is muted. The words say the same, so color is never the only signal. Also used by
 * shared trips (MAZ-93).
 */
export function MonthBalance({ month, balance, loading, view }: { month: string; balance: number | undefined; loading: boolean; view: HouseholdView }) {
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
        {name} · you owe <Money cents={-balance} currency={view.currency} tone="expense" />
      </>
    );
  }
  return (
    <>
      {name} · you're settled <Money cents={0} currency={view.currency} tone="muted" />
    </>
  );
}

