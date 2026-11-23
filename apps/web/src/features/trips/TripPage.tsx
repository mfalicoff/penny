import { AddEntryDialog } from "../entries/AddEntryDialog";
import type { Ledger, Transaction, Trip } from "@domain/ledger.ts";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import { householdDetailQuery, householdExpensesQuery, householdsQuery, monthRecapQuery } from "../../api/households";
import { useEmailEnabled } from "../../api/info";
import { usePageTitle, usePageTitleStyle } from "../../app/shell/pageTitle";
import { useAccountEmail } from "../../auth/account";
import { useIsDemo } from "../../demo/demo";
import { Avatar, Badge, Card, cx } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { tileStyle } from "../../design/categoryTint";
import { formatCents, Money } from "../../design/Money";
import { Banner, EmptyState, ErrorState, LoadingState } from "../../design/states";
import { EntryDetailDialog } from "../entries/EntryDetail";
import { EntryFormDialog } from "../entries/EntryForm";
import { categoryIcon } from "../entries/model";
import { useLedgerWriter } from "../entries/writer";
import { BalancesTab } from "../households/BalancesTab";
import { householdView, type HouseholdView } from "../households/context";
import { describeLoadError } from "../households/errors";
import { ExpenseDetailDialog } from "../households/ExpenseDetail";
import { ExpenseFormDialog, type FormTarget } from "../households/ExpenseForm";
import { HistoryPanel } from "../households/HistoryPanel";
import { InviteEmailDialog } from "../households/InviteEmailDialog";
import { GroupToolbar, MoreMenu, ToolButton, ToolContent, toolClass, type MoreItem } from "../households/GroupTools";
import { GroupLink, type GroupSearch } from "../households/links";
import { currentMonth, dayLabel, isCurrent, memberName, monthLabel, people } from "../households/model";
import type { HouseholdMember, MonthRecap } from "../../api/schemas";
import { OnlineNotice } from "../households/OnlineNotice";
import { PeopleTab } from "../households/PeopleTab";
import { RuleDialog } from "../households/RuleDialog";
import { MonthBarControls } from "../home/parts";
import { TOUCH_TABLET, useMediaQuery, WIDE } from "../../app/useMediaQuery";
import type { HouseholdTab } from "../households/search";
import { useLedgerWorkspace } from "../organize/workspace";
import { isSharedTrip, outsideRange, peopleCount, phaseLabel, privateExpenses, shareByCategory, sharedTripTotals, tripMonth, tripOverview, tripRange, type CategoryShare } from "./model";
import type { TripSearch } from "./search";
import { TripExpenses } from "./TripExpenses";
import { ShareTripDialog, TripFormDialog } from "./TripForm";

/**
 * `/trips/$id`: a personal trip by its ledger id, or a shared trip by its household id. Personal
 * trips are looked up first, in this browser's ledger.
 */
export function TripPage({ id, search }: { id: string; search: TripSearch }) {
  const workspace = useLedgerWorkspace();
  const personal = workspace.ledger?.trips.find((trip) => trip.id === id);
  if (personal && workspace.ledger) return <PersonalTripPage trip={personal} ledger={workspace.ledger} />;
  if (workspace.status === "loading") return <LoadingState label="Opening the trip…" />;
  return <SharedTripPage householdId={id} search={search} />;
}

/** The way out of a trip that can't open; otherwise the top bar's Back (phones) or the sidebar's All trips. */
function AllTripsLink() {
  return (
    <Link to="/trips" className="wbtn wbtn--secondary" style={{ justifySelf: "center" }}>
      All trips
    </Link>
  );
}

/* ---------- personal trip ---------- */

/**
 * A personal trip (specimen `personal-trip`): travel dates, your spending, by category and every
 * assigned expense, including ones dated before or after the trip. The navigation bar (MAZ-229, as
 * on `iphone-trip-detail` and `ipad-trip`) has Share trip, which turns it into a shared trip, and
 * a … menu with Edit trip. Trip expense, which adds a personal expense already on this trip, is
 * the copper button from 1100px and the menu's first item below that.
 */
function PersonalTripPage({ trip, ledger }: { trip: Trip; ledger: Ledger }) {
  const email = useAccountEmail();
  const demo = useIsDemo();
  const writer = useLedgerWriter();
  const households = useQuery({ ...householdsQuery(email), enabled: !demo && Boolean(trip.sharedHouseholdId) });
  const overview = useMemo(() => tripOverview(ledger, trip), [ledger, trip]);
  const [dialog, setDialog] = useState<"edit" | "share" | "add" | null>(null);
  const [open, setOpen] = useState<Transaction | null>(null);
  usePageTitle(trip.name);
  const money = (cents: number) => formatCents(cents, ledger.currency);
  const outside = outsideRange(overview.expenses, trip);
  const sharedAs = trip.sharedHouseholdId ? households.data?.find((household) => household.id === trip.sharedHouseholdId && household.trip) : undefined;
  const wide = useMediaQuery(WIDE);
  const more: MoreItem[] = [
    ...(wide ? [] : [{ label: "Trip expense", icon: "add" as const, onSelect: () => { setDialog("add"); } }]),
    { label: "Edit trip", icon: "create", onSelect: () => { setDialog("edit"); } },
  ];

  return (
    <div className="page trips">
      <GroupToolbar ownAdd>
        {!demo && !trip.sharedHouseholdId ? <ToolButton icon="person-add" label="Share trip" onClick={() => { setDialog("share"); }} /> : null}
        <MoreMenu items={more} label="Trip actions" />
        {wide ? <ToolButton primary icon="add" label="Trip expense" onClick={() => { setDialog("add"); }} /> : null}
      </GroupToolbar>
      <section className="trip-head" aria-label="Trip summary">
        <div className="trip-head__summary">
          <span className="trip-hero__badges">
            <Badge>{phaseLabel(trip)}</Badge>
            <Badge icon="lock-closed">{trip.sharedHouseholdId && !sharedAs ? "Personal · was shared" : "Personal"}</Badge>
          </span>
          <p className="trip-head__dates">{tripRange(trip.startDate, trip.endDate)}</p>
        </div>
      </section>

      {sharedAs ? (
        <Banner
          tone="info"
          title={`Shared as ${sharedAs.name}`}
          action={
            <Link to="/trips/$id" params={{ id: sharedAs.id }} className="wbtn wbtn--secondary">
              Open shared trip
            </Link>
          }
        >
          These expenses are from before sharing. They stay private to you and count in your share only.
        </Banner>
      ) : null}

      <dl className="trip-stats trip-stats--card">
        <div>
          <dt>Your share</dt>
          <dd>
            <Money cents={overview.total} currency={ledger.currency} />
          </dd>
        </div>
        <div>
          <dt>Expenses</dt>
          <dd className="pk-num">{overview.expenses.length}</dd>
        </div>
        {overview.receiptTotal !== overview.total ? (
          <div>
            <dt>Receipt totals</dt>
            <dd className="pk-num">{money(overview.receiptTotal)}</dd>
          </div>
        ) : null}
      </dl>
      {overview.receiptTotal !== overview.total ? <p className="note">Only your share of a split expense counts toward the trip.</p> : null}

      <div className="household-columns">
        <div className="page">
          <Card title="Trip expenses" action={outside ? <span className="muted">{outside} outside the trip dates</span> : undefined}>
            {overview.expenses.length ? (
              <ul className="row-list" aria-label="Trip expenses">
                {overview.expenses.map((entry) => (
                  <li key={entry.id}>
                    <ExpenseRow entry={entry} ledger={ledger} trip={trip} pending={writer.pending.has(entry.id)} onOpen={() => { setOpen(entry); }} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon="receipt" title="No expenses on this trip yet">
                <p>Add one with Trip expense, or choose this trip under More details when you add an expense. Expenses before or after the dates count too.</p>
              </EmptyState>
            )}
          </Card>
        </div>
        <Card title="By category">
          {overview.categories.length ? (
            <ul className="row-list" aria-label="Spending by category">
              {overview.categories.map((category) => (
                <li key={category.id} className="row row--plain">
                  <span className="trip-category">
                    <span className="category-dot" style={tileStyle(category)}>
                      <Icon name={categoryIcon(category.icon)} size={16} />
                    </span>
                    {category.name}
                  </span>
                  <span className="row__end">
                    <Money cents={category.amount} currency={ledger.currency} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="note">Assign an expense to see where the trip money went.</p>
          )}
        </Card>
      </div>

      {dialog === "edit" ? <TripFormDialog target={{ kind: "personal", trip, expenseCount: overview.expenses.length }} onClose={() => { setDialog(null); }} /> : null}
      {dialog === "share" ? <ShareTripDialog trip={trip} expenseCount={overview.expenses.length} onClose={() => { setDialog(null); }} /> : null}
      {dialog === "add" ? <EntryFormDialog target={{ kind: "new", tripId: trip.id }} onClose={() => { setDialog(null); }} /> : null}
      {open ? <EntryDetailDialog entry={open} onClose={() => { setOpen(null); }} /> : null}
    </div>
  );
}

function ExpenseRow({ entry, ledger, trip, pending, onOpen }: { entry: Transaction; ledger: Ledger; trip: { startDate: string; endDate: string }; pending: boolean; onOpen: () => void }) {
  const category = ledger.categories.find((item) => item.id === entry.categoryId);
  const outside = entry.date < trip.startDate || entry.date > trip.endDate;
  return (
    <button type="button" className="row trip-row" onClick={onOpen}>
      <span className="category-dot" style={tileStyle(category)} aria-hidden="true">
        <Icon name={categoryIcon(category?.icon)} size={18} />
      </span>
      <span>
        <span className="row__title">{entry.title}</span>
        <span className="row__meta" style={{ display: "block" }}>
          <time dateTime={entry.date}>{dayLabel(entry.date, true)}</time> · {category?.name ?? "Unknown category"}
          {outside ? " · outside the trip dates" : ""}
        </span>
      </span>
      <span className="row__end">
        <Money cents={entry.share} currency={ledger.currency} />
        {entry.share !== entry.total ? <span className="row__meta">of {formatCents(entry.total, ledger.currency)}</span> : null}
        {pending ? (
          <Badge tone="pending" icon="time">
            Waiting to sync
          </Badge>
        ) : null}
      </span>
    </button>
  );
}

/* ---------- shared trip ---------- */

const TAB_LABEL: Record<Exclude<HouseholdTab, "history">, string> = { expenses: "Expenses", balances: "Balances", people: "People" };

/**
 * A shared trip (specimens `shared-trip`, `trip-people`, `trip-balances`; card
 * `iphone-trip-detail`, `ipad-trip`): the household page's Expenses, Balances and People for a
 * trip, under `/trips/$id`. Expenses leads with a centered hero: the name (the bar's title stays
 * for screen readers on phones), the dates and people, the trip total and your share under it.
 * From 1100px the hero is on the left with the countdown, Trip total and Your share, People with
 * each member's balance beside it, and Your share by category beside the expenses. On the desktop
 * (card `web-trip`; a touch tablet keeps `ipad-trip`) the hero is one surface with People and what
 * each paid, the sections are chips, and the expenses are a Shared with everyone table and an Only
 * you table; the bar has Back and a labelled Invite. Balances open
 * on the trip's month before or after it (`tripMonth`). Expenses lists the whole trip whatever the month, plus your private
 * expenses from before sharing ("Only you"); Balances still settle month by month; People invites
 * and manages. The navigation bar (MAZ-229) has Invite and a … menu with Edit trip and History;
 * Trip expense is the copper button from 1100px and the menu's first item below that. Balances,
 * People and History drop the trip's hero, as the household does.
 */
function SharedTripPage({ householdId, search }: { householdId: string; search: TripSearch }) {
  const email = useAccountEmail();
  const navigate = useNavigate();
  const workspace = useLedgerWorkspace();
  const tab: HouseholdTab = search.tab ?? "expenses";
  const detail = useQuery(householdDetailQuery(email, householdId));
  const range = detail.data?.household.trip;
  const month = search.month ?? (range ? tripMonth(range) : currentMonth());
  const list = useQuery(householdsQuery(email));
  const isTrip = Boolean(detail.data?.household.trip);
  const recap = useQuery({ ...monthRecapQuery(email, householdId, month), enabled: isTrip });
  const expenses = useQuery({ ...householdExpensesQuery(email, householdId), enabled: isTrip });
  const [form, setForm] = useState<FormTarget | null>(search.add ? { kind: "new" } : null);
  const [editing, setEditing] = useState(false);
  const emailEnabled = useEmailEnabled();
  const [inviting, setInviting] = useState(false);
  const [openPrivate, setOpenPrivate] = useState<Transaction | null>(null);
  const wide = useMediaQuery(WIDE);
  // The desktop (`web-trip`); a touch tablet from 1100px keeps the iPad card (`ipad-trip`).
  const touch = useMediaQuery(TOUCH_TABLET);
  const desktop = wide && !touch;
  usePageTitle(detail.data?.household.name);
  usePageTitleStyle(tab === "expenses" ? "hero" : "inline");

  // A `?add=1` link (Trip expense from the list) opens the form once; drop it so Back and reload don't reopen it.
  const consumedAdd = useRef(false);
  useEffect(() => {
    if (!search.add || consumedAdd.current) return;
    consumedAdd.current = true;
    void navigate({ to: ".", search: { ...search, add: undefined }, replace: true });
  }, [search, navigate]);

  if (detail.isPending) return <LoadingState label="Opening the trip…" />;
  if (detail.isError) {
    const missing = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <div className="page">
        <AllTripsLink />
        {missing ? (
          <EmptyState icon="airplane" title="This trip isn't here">
            <p>It was deleted, archived or never shared with you. Your own trips are under All trips.</p>
          </EmptyState>
        ) : (
          <ErrorState title="Penny couldn't open this trip" onRetry={() => void detail.refetch()} retrying={detail.isFetching}>
            {describeLoadError(detail.error)}
          </ErrorState>
        )}
      </div>
    );
  }
  const household = detail.data.household;
  // A household id under /trips (a hand-edited link) opens the household's own page.
  if (!isSharedTrip(household)) return <Navigate to="/households/$id" params={{ id: householdId }} replace />;

  const who = people(detail.data, email);
  const archived = list.isSuccess && !list.data.some((item) => item.id === householdId);
  const view = householdView(householdId, detail.data, who, month, archived, "trips");
  const current = detail.data.members.filter(isCurrent);
  // Private expenses are in the ledger currency; a trip in another currency can't add them up.
  const sameCurrency = workspace.ledger?.currency === household.currency;
  const mine = sameCurrency ? privateExpenses(workspace.ledger, householdId) : [];
  const totals = expenses.data ? sharedTripTotals(expenses.data, who.meId, mine, household.trip) : null;
  const linkSearch = (next: Partial<GroupSearch>): GroupSearch => ({ month: search.month, tab: search.tab, ...next });
  const go = (next: Partial<GroupSearch>) => void navigate({ to: "/trips/$id", params: { id: householdId }, search: linkSearch(next) });
  const closeRule = () => void navigate({ to: ".", search: linkSearch({}), replace: true });
  const more: MoreItem[] = [
    ...(view.canWrite && !wide ? [{ label: "Trip expense", icon: "add" as const, onSelect: () => { setForm({ kind: "new" }); } }] : []),
    ...(view.canWrite && view.creator ? [{ label: "Edit trip", icon: "create" as const, onSelect: () => { setEditing(true); } }] : []),
    { label: "History", icon: "time", onSelect: () => { go({ tab: "history" }); } },
  ];

  // The month pill reports this month as no month; a trip's default is its own month, so keep it explicit.
  return (
    <div className="page trips">
      <GroupToolbar ownAdd lead={tab === "balances" ? <MonthBarControls month={month} onChange={(next) => { go({ month: next ?? currentMonth() }); }} /> : null}>
        {view.canWrite && view.creator && emailEnabled ? (
          // MAZ-124: with email on the server, Invite opens Invite by email, titled with the trip.
          <ToolButton icon="person-add" label="Invite" labelled={desktop} onClick={() => { setInviting(true); }} />
        ) : view.canWrite && view.creator ? (
          <GroupLink route="trips" householdId={householdId} search={linkSearch({ tab: "people" })} className={toolClass({ labelled: desktop })}>
            <ToolContent icon="person-add" label="Invite" labelled={desktop} />
          </GroupLink>
        ) : null}
        <MoreMenu items={more} label="Trip actions" />
        {view.canWrite && wide ? <ToolButton primary icon="add" label="Trip expense" onClick={() => { setForm({ kind: "new" }); }} /> : null}
      </GroupToolbar>
      <OnlineNotice />
      {tab === "expenses" && desktop ? (
        <section className="card trip-feature" aria-label="Trip summary">
          <div className="trip-feature__main">
            <span className="trip-feature__when">{phaseLabel(household.trip)}</span>
            {/* The bar's title is the page's heading; the hero repeats the name, as on the card. */}
            <p className="trip-feature__name" aria-hidden="true">
              {household.name}
            </p>
            {archived ? <Badge>Archived</Badge> : null}
            <p className="trip-feature__meta">
              {tripRange(household.trip.startDate, household.trip.endDate)} · {current.length > 1 ? `shared with ${peopleCount(current.length - 1)}` : "only you so far"}
            </p>
            <dl className="trip-feature__nums" aria-live="polite">
              <div>
                <dt>Trip total</dt>
                <dd className="pk-num">{totals ? view.money(totals.tripTotal) : "…"}</dd>
              </div>
              <div>
                <dt>Your share</dt>
                <dd className="pk-num">{totals ? view.money(totals.yourSpending) : "…"}</dd>
              </div>
            </dl>
            {totals && totals.outside > 0 ? (
              <p className="note">
                {`${String(totals.outside)} ${totals.outside === 1 ? "expense is" : "expenses are"} dated outside the trip and still ${totals.outside === 1 ? "belongs" : "belong"} to it.`}
              </p>
            ) : null}
          </div>
          <TripPeople members={current} recap={recap.data} loading={recap.isPending} month={month} view={view} />
        </section>
      ) : tab === "expenses" ? (
        <section className={wide ? "trip-detail-head trip-detail-head--wide" : "trip-detail-head"} aria-label="Trip summary">
          <div className="glow" aria-hidden="true" />
          <div className="trip-detail-hero">
            {wide ? <span className="trip-hero__when">{phaseLabel(household.trip)}</span> : null}
            {/* The bar's title is the page's heading; on phones it's only for screen readers, so the hero shows the name. */}
            <p className="trip-detail-hero__name" aria-hidden="true">
              {household.name}
            </p>
            {archived ? <Badge>Archived</Badge> : null}
            <p className="trip-detail-hero__meta">
              {wide
                ? `${tripRange(household.trip.startDate, household.trip.endDate)} · ${current.length > 1 ? `shared with ${peopleCount(current.length - 1)}` : "only you so far"}`
                : `${tripRange(household.trip.startDate, household.trip.endDate, { year: "auto" })} · ${peopleCount(current.length)}`}
            </p>
            {wide ? (
              <dl className="trip-stats trip-stats--hero" aria-live="polite">
                <div>
                  <dt>Trip total</dt>
                  <dd className="pk-num">{totals ? view.money(totals.tripTotal) : "…"}</dd>
                </div>
                <div>
                  <dt>Your share</dt>
                  <dd className="pk-num">{totals ? view.money(totals.yourSpending) : "…"}</dd>
                </div>
              </dl>
            ) : (
              <div className="trip-detail-hero__lead" aria-live="polite">
                <p className="trip-detail-hero__total pk-num">{totals ? view.money(totals.tripTotal) : "…"}</p>
                <p className="trip-detail-hero__yours">
                  trip total · your share <b className="pk-num">{totals ? view.money(totals.yourSpending) : "…"}</b>
                </p>
              </div>
            )}
            {totals && totals.outside > 0 ? (
              <p className="note">
                {`${String(totals.outside)} ${totals.outside === 1 ? "expense is" : "expenses are"} dated outside the trip and still ${totals.outside === 1 ? "belongs" : "belong"} to it.`}
              </p>
            ) : null}
          </div>
          {wide ? <PeopleBalances members={current} balances={recap.data?.balances} loading={recap.isPending} month={month} view={view} /> : null}
        </section>
      ) : null}

      {archived ? (
        <Banner tone="info" title="This trip is archived">
          Its expenses, balances and history stay readable. Nothing in it can change.
        </Banner>
      ) : who.meId && !who.isCurrentMember(who.meId) ? (
        <Banner tone="info" title="You left this trip">
          You can still see your own history here, but you can't add or change anything.
        </Banner>
      ) : null}

      <nav className={cx("section-tabs", desktop && "section-tabs--chips")} aria-label="Trip sections">
        {(Object.keys(TAB_LABEL) as (keyof typeof TAB_LABEL)[]).map((key) => (
          <GroupLink key={key} route="trips" householdId={householdId} search={linkSearch({ tab: key === "expenses" ? undefined : key })} aria-current={tab === key ? "page" : undefined} exact>
            {TAB_LABEL[key]}
          </GroupLink>
        ))}
      </nav>

      {tab === "expenses" ? (
        wide ? (
          <div className="trip-detail-columns">
            <TripExpenses view={view} expenses={expenses} mine={mine} ledger={workspace.ledger} search={linkSearch({})} onOpenPrivate={setOpenPrivate} combined tables={desktop} />
            <ShareByCategory note={!desktop} rows={expenses.data ? shareByCategory(expenses.data, who.meId, mine, workspace.ledger?.categories ?? []) : null} currency={household.currency} />
          </div>
        ) : (
          <TripExpenses view={view} expenses={expenses} mine={mine} ledger={workspace.ledger} search={linkSearch({})} onOpenPrivate={setOpenPrivate} combined={false} />
        )
      ) : tab === "balances" ? (
        <>
          <p className="note">A trip settles month by month, like a household: each month's balance is separate, and months don't offset each other.</p>
          <BalancesTab view={view} recap={recap} />
        </>
      ) : tab === "people" ? (
        <PeopleTab view={view} recap={recap.data} {...(view.creator ? { onEditTrip: () => { setEditing(true); } } : {})} />
      ) : (
        <HistoryPanel view={view} />
      )}

      {search.expense ? (
        <ExpenseDetailDialog
          view={view}
          expenseId={search.expense}
          onEdit={(expense) => { setForm({ kind: "edit", expense }); }}
          onRule={(rule) => { go({ rule }); }}
          onClose={() => { go({}); }}
        />
      ) : null}
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
      {editing ? <TripFormDialog target={{ kind: "shared", household }} onClose={() => { setEditing(false); }} /> : null}
      {inviting && emailEnabled ? <InviteEmailDialog view={view} onClose={() => { setInviting(false); }} /> : null}
      {openPrivate ? <EntryDetailDialog entry={openPrivate} onClose={() => { setOpenPrivate(null); }} /> : null}
    </div>
  );
}

/**
 * People (card `ipad-trip`, from 1100px): each current member and their balance in the trip's
 * month, in words as well as color: "owes", "gets back" or "settled".
 */
function PeopleBalances({ members, balances, loading, month, view }: { members: HouseholdMember[]; balances: readonly { userId: string; balanceCents: number }[] | undefined; loading: boolean; month: string; view: HouseholdView }) {
  return (
    <Card title="People" action={<span className="muted">{monthLabel(month).split(" ")[0]} balance</span>} className="trip-people">
      <ul className="row-list" aria-label={`Balances for ${monthLabel(month)}`}>
        {[...members].sort((a, b) => Number(b.userId === view.who.meId) - Number(a.userId === view.who.meId)).map((member) => {
          const cents = balances?.find((row) => row.userId === member.userId)?.balanceCents ?? 0;
          return (
            <li key={member.userId} className="row row--plain trip-people__row">
              <Avatar name={memberName(member)} src={member.avatarUrl} size={36} />
              <span className="row__title trip-people__name">{view.who.name(member.userId)}</span>
              <span className="row__end trip-people__balance">
                {loading ? (
                  "…"
                ) : (
                  <>
                    <Money cents={cents} currency={view.currency} signed={cents !== 0} tone={cents > 0 ? "income" : "expense"} />
                    <span className="row__meta">{cents > 0 ? "gets back" : cents < 0 ? "owes" : "settled"}</span>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/**
 * People on the desktop hero (`web-trip`): each current member with what they paid this month and
 * their balance: signed for the others (gets back in green), and "you owe" or "you're owed" over
 * your own amount, so the words carry the meaning as well as the color.
 */
function TripPeople({ members, recap, loading, month, view }: { members: HouseholdMember[]; recap: MonthRecap | undefined; loading: boolean; month: string; view: HouseholdView }) {
  const paid = new Map<string, number>();
  for (const expense of recap?.expenses ?? []) paid.set(expense.payerUserId, (paid.get(expense.payerUserId) ?? 0) + expense.totalCents);
  const me = view.who.meId;
  // You come last, as on the card: the others first, then where you stand.
  const ordered = [...members].sort((a, b) => Number(a.userId === me) - Number(b.userId === me));
  return (
    <section className="trip-feature__people" aria-labelledby="trip-people-heading">
      <div className="trip-feature__people-head">
        <h2 id="trip-people-heading">People</h2>
        <span>{monthLabel(month).split(" ")[0]} balance</span>
      </div>
      <ul className="trip-feature__people-rows" aria-label={`Balances for ${monthLabel(month)}`}>
        {ordered.map((member) => {
          const cents = recap?.balances.find((row) => row.userId === member.userId)?.balanceCents ?? 0;
          const mine = member.userId === me;
          let balance;
          if (loading) balance = <span className="trip-feature__balance">…</span>;
          else if (mine) {
            balance = (
              <span className="trip-feature__balance trip-feature__balance--mine">
                {cents > 0 ? "you're owed" : cents < 0 ? "you owe" : "settled"}
                <Money cents={Math.abs(cents)} currency={view.currency} tone={cents > 0 ? "income" : "expense"} />
              </span>
            );
          } else {
            balance = (
              <span className="trip-feature__balance">
                <Money cents={cents} currency={view.currency} signed={cents !== 0} tone={cents > 0 ? "income" : "expense"} />
                <span className="visually-hidden">{cents > 0 ? "gets back" : cents < 0 ? "owes" : "settled"}</span>
              </span>
            );
          }
          return (
            <li key={member.userId} className="trip-feature__person">
              <Avatar name={memberName(member)} src={member.avatarUrl} size={30} />
              <span className="trip-feature__who">
                <span>{view.who.name(member.userId)}</span>
                <span>Paid {view.money(paid.get(member.userId) ?? 0)}</span>
              </span>
              {balance}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Your share by category (card `ipad-trip`, from 1100px): a bar per category against the largest. */
function ShareByCategory({ rows, currency, note }: { rows: CategoryShare[] | null; currency: string; note: boolean }) {
  const largest = rows?.[0]?.amount ?? 0;
  return (
    <Card title="Your share by category" className="trip-categories">
      {!rows ? (
        <p className="note">Loading the trip's expenses…</p>
      ) : rows.length ? (
        <ul className="row-list" aria-label="Your share by category">
          {rows.map((row) => (
            <li key={row.key} className="trip-categories__row">
              <span className="category-dot" style={tileStyle(row)} aria-hidden="true">
                <Icon name={categoryIcon(row.icon)} size={16} />
              </span>
              <span className="trip-categories__name">{row.name}</span>
              <span className="trip-categories__bar" aria-hidden="true">
                <span style={{ width: `${String(Math.max(2, Math.round((row.amount / largest) * 100)))}%`, ...barColor(row) }} />
              </span>
              <Money cents={row.amount} currency={currency} className="trip-categories__amount" />
            </li>
          ))}
        </ul>
      ) : (
        <p className="note">Your share shows here once the trip has expenses.</p>
      )}
      {/* The iPad card ends with how balances settle; the desktop's Only you says what counts where. */}
      {note ? <p className="note">Balances settle per month, so expenses in different months are reimbursed separately.</p> : null}
    </Card>
  );
}

/** The bar takes the category tile's own color. */
const barColor = (category: { color: string; icon: string }) => tileStyle(category);
