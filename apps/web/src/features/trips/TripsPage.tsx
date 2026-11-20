import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ApiError } from "../../api/client";
import { householdDetailQuery, householdExpensesQuery, householdsQuery } from "../../api/households";
import { useMediaQuery, WIDE } from "../../app/useMediaQuery";
import { useAccountEmail } from "../../auth/account";
import { useIsDemo } from "../../demo/demo";
import { Badge, Button } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { formatCents, Money } from "../../design/Money";
import { Banner, EmptyState, ErrorState, LoadingState } from "../../design/states";
import { EntryFormDialog } from "../entries/EntryForm";
import { GroupToolbar, ToolButton } from "../households/GroupTools";
import { findMe } from "../households/model";
import { JoinTripDialog } from "../households/StartDialogs";
import { useLedgerWorkspace } from "../organize/workspace";
import { featuredTrip, phaseLabel, privateExpenses, rangeLabel, sharedTripTotals, tripCards, tripOverview, tripSections, type TripCard } from "./model";
import { TripFormDialog } from "./TripForm";

/**
 * Trips (cards `iphone-trips`, `web-trips`): the trip happening now or coming next, then the
 * others. Phones and tablets list them under UPCOMING and PAST; from 1100px they're a grid of
 * tiles ending with a New trip tile, and the featured trip shows its expenses. Personal trips come
 * from this browser's ledger (offline first); shared trips from the server. A personal trip that
 * was shared shows once, as the shared trip. Join a trip (key) and New trip (+) are the
 * navigation bar's icons (MAZ-229); from 1100px New trip is the tile.
 */
export function TripsPage() {
  const email = useAccountEmail();
  const demo = useIsDemo();
  const workspace = useLedgerWorkspace();
  const households = useQuery({ ...householdsQuery(email), enabled: !demo });
  const [dialog, setDialog] = useState<"new" | "join" | null>(null);
  const [tripExpense, setTripExpense] = useState<string | null>(null);
  const wide = useMediaQuery(WIDE);
  const cards = useMemo(() => tripCards(workspace.ledger, households.data), [workspace.ledger, households.data]);
  const featured = featuredTrip(cards);
  const currency = workspace.ledger?.currency;

  if (workspace.status === "loading") return <LoadingState label="Loading your trips…" />;
  if (workspace.status === "error" && !workspace.ledger) {
    return (
      <ErrorState title="Penny couldn't load your trips" onRetry={workspace.retry} retrying={workspace.retrying}>
        {workspace.loadError}
      </ErrorState>
    );
  }

  const sharedUnavailable = demo
    ? "The demo has no shared trips. Sign in to your own Penny server to share one."
    : households.isError && !households.data
      ? households.error instanceof ApiError && households.error.status === 0
        ? "Shared trips need a connection. Your personal trips are all here."
        : "Penny couldn't load your shared trips. Your personal trips are all here."
      : null;
  const rest = cards.filter((card) => card !== featured);
  const sections = tripSections(rest);

  return (
    <div className="page trips">
      <GroupToolbar>
        {demo ? null : <ToolButton icon="key" label="Join a trip" onClick={() => { setDialog("join"); }} />}
        {wide ? null : <ToolButton icon="add" label="New trip" onClick={() => { setDialog("new"); }} />}
      </GroupToolbar>

      {sharedUnavailable ? (
        <Banner tone="info" title="Shared trips aren't available" action={households.isError && !demo ? <Button variant="quiet" onClick={() => void households.refetch()}>Try again</Button> : undefined}>
          {sharedUnavailable}
        </Banner>
      ) : null}

      {cards.length === 0 && !households.isLoading ? (
        <EmptyState icon="airplane" title="Your next trip starts here">
          <p>Create a trip with New trip, then assign expenses to see its total. Share it to split costs with the people you travel with.</p>
        </EmptyState>
      ) : null}

      {featured ? (
        <FeaturedTrip
          card={featured}
          currency={currency}
          expenses={wide}
          onTripExpense={() => {
            setTripExpense(featured.id);
          }}
        />
      ) : null}

      {!wide ? (
        <>
          {sections.upcoming.length ? <TripList id="trips-upcoming" title="Upcoming" cards={sections.upcoming} currency={currency} /> : null}
          {sections.past.length ? <TripList id="trips-past" title="Past" cards={sections.past} currency={currency} /> : null}
        </>
      ) : (
        <section className="shared-section" aria-labelledby="trips-all">
          <h2 id="trips-all">{featured ? "All trips" : "Trips"}</h2>
          <ul className="trip-grid">
            {rest.map((card) => (
              <li key={`${card.kind}-${card.id}`}>
                <TripTile card={card} currency={currency} />
              </li>
            ))}
            <li>
              <button type="button" className="trip-tile trip-tile--new" onClick={() => { setDialog("new"); }}>
                <Icon name="add" />
                New trip
              </button>
            </li>
          </ul>
        </section>
      )}

      {dialog === "new" ? <TripFormDialog target={{ kind: "new" }} onClose={() => { setDialog(null); }} /> : null}
      {dialog === "join" ? <JoinTripDialog onClose={() => { setDialog(null); }} /> : null}
      {tripExpense ? <EntryFormDialog target={{ kind: "new", tripId: tripExpense }} onClose={() => { setTripExpense(null); }} /> : null}
    </div>
  );
}

function kindBadge(card: TripCard) {
  if (card.kind === "shared") {
    return (
      <Badge icon="people">
        Shared · {card.household.memberCount} {card.household.memberCount === 1 ? "person" : "people"}
      </Badge>
    );
  }
  return card.wasShared ? <Badge icon="lock-closed">Personal · was shared</Badge> : <Badge icon="lock-closed">Personal</Badge>;
}

function TripTile({ card, currency }: { card: TripCard; currency: string | undefined }) {
  return (
    <Link to="/trips/$id" params={{ id: card.id }} className="trip-tile">
      <span className="trip-tile__top">
        <span className="trip-tile__icon" aria-hidden="true">
          <Icon name={card.kind === "shared" ? "people" : "airplane"} />
        </span>
        {kindBadge(card)}
      </span>
      <span className="trip-tile__name">{card.name}</span>
      <span className="trip-tile__meta">
        {rangeLabel(card.startDate, card.endDate)} · {phaseLabel(card).toLowerCase()}
      </span>
      {card.kind === "personal" ? (
        <span className="trip-tile__amount">
          <Money cents={card.total} currency={currency} />
          <span className="trip-tile__meta">
            {card.count} {card.count === 1 ? "expense" : "expenses"}
          </span>
        </span>
      ) : (
        <span className="trip-tile__meta">{card.household.currency} · open for balances</span>
      )}
    </Link>
  );
}

/** UPCOMING or PAST on phones and tablets (card `iphone-trips`): a row per trip that opens it. */
function TripList({ id, title, cards, currency }: { id: string; title: string; cards: TripCard[]; currency: string | undefined }) {
  return (
    <section className="shared-section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <ul className="group-list" aria-labelledby={id}>
        {cards.map((card) => (
          <li key={`${card.kind}-${card.id}`}>
            <Link to="/trips/$id" params={{ id: card.id }} className="row trip-list-row">
              <span className="trip-tile__icon" aria-hidden="true">
                <Icon name="airplane" />
              </span>
              <span>
                <span className="row__title">{card.name}</span>
                <span className="row__meta trip-list-row__meta">
                  {rangeLabel(card.startDate, card.endDate)} {card.kind === "shared" ? <Badge icon="people">Shared</Badge> : <Badge icon="lock-closed">Personal</Badge>}
                </span>
              </span>
              <span className="row__end trip-list-row__end">
                {card.kind === "personal" ? <Money cents={card.total} currency={currency} /> : null}
                <Icon name="chevron-forward" size={16} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The trip happening now or next, with its numbers, the contextual add action and, from 1100px, its expenses. */
function FeaturedTrip({ card, currency, expenses, onTripExpense }: { card: TripCard; currency: string | undefined; expenses: boolean; onTripExpense: () => void }) {
  const navigate = useNavigate();
  return (
    <section className={expenses ? "trip-hero trip-hero--with-expenses" : "trip-hero"} aria-labelledby="trip-hero-name">
      <div className="trip-hero__main">
        <span className="trip-hero__badges">
          <Badge>{phaseLabel(card)}</Badge>
          {kindBadge(card)}
        </span>
        <h2 id="trip-hero-name" className="trip-hero__name">
          {card.name}
        </h2>
        <p className="muted">{rangeLabel(card.startDate, card.endDate)}</p>
        {card.kind === "personal" ? (
          <dl className="trip-stats">
            <div>
              <dt>Your spending</dt>
              <dd>
                <Money cents={card.total} currency={currency} />
              </dd>
            </div>
            <div>
              <dt>Expenses</dt>
              <dd className="pk-num">{card.count}</dd>
            </div>
          </dl>
        ) : (
          <SharedHeroStats card={card} />
        )}
        <div className="shared-actions">
          <Button
            variant="primary"
            icon="add"
            onClick={() => {
              if (card.kind === "personal") onTripExpense();
              else void navigate({ to: "/trips/$id", params: { id: card.id }, search: { add: 1 } });
            }}
          >
            Trip expense
          </Button>
          <Link to="/trips/$id" params={{ id: card.id }} className="wbtn wbtn--secondary">
            Open trip
          </Link>
        </div>
      </div>
      {expenses ? card.kind === "personal" ? <PersonalTripExpenses card={card} /> : <SharedTripExpenses card={card} /> : null}
    </section>
  );
}

interface PreviewRow {
  id: string;
  title: string;
  paidBy: string;
  yours: number;
  only?: boolean;
}

const PREVIEW_ROWS = 5;

/** The featured trip's expenses on desktop (card `web-trips`): what each was, who paid and your part. */
function TripExpenseTable({ rows, currency, more }: { rows: PreviewRow[]; currency: string | undefined; more: number }) {
  if (!rows.length) return <p className="muted trip-hero__expenses">No expenses on this trip yet.</p>;
  return (
    <div className="trip-hero__expenses">
      <table className="trip-expense-table">
        <caption className="visually-hidden">Trip expenses</caption>
        <thead>
          <tr>
            <th scope="col">Expense</th>
            <th scope="col">Paid by</th>
            <th scope="col">Yours</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">
                {row.title}
                {row.only ? (
                  <>
                    {" "}
                    <Badge icon="lock-closed">Only you</Badge>
                  </>
                ) : null}
              </th>
              <td>{row.paidBy}</td>
              <td>
                <Money cents={row.yours} currency={currency} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {more > 0 ? <p className="note">{more} more in the trip.</p> : null}
    </div>
  );
}

function PersonalTripExpenses({ card }: { card: Extract<TripCard, { kind: "personal" }> }) {
  const workspace = useLedgerWorkspace();
  const ledger = workspace.ledger;
  if (!ledger) return null;
  const all = tripOverview(ledger, card.trip).expenses;
  const rows = all.slice(0, PREVIEW_ROWS).map((entry) => ({ id: entry.id, title: entry.title, paidBy: "You", yours: entry.share }));
  return <TripExpenseTable rows={rows} currency={ledger.currency} more={all.length - rows.length} />;
}

function SharedTripExpenses({ card }: { card: Extract<TripCard, { kind: "shared" }> }) {
  const email = useAccountEmail();
  const workspace = useLedgerWorkspace();
  const detail = useQuery(householdDetailQuery(email, card.id));
  const expenses = useQuery(householdExpensesQuery(email, card.id));
  if (!detail.data || !expenses.data) return <p className="muted trip-hero__expenses">{expenses.isError || detail.isError ? "Open the trip to see its expenses." : "Loading the trip's expenses…"}</p>;
  const me = findMe(detail.data.members, email)?.userId;
  const name = (userId: string) => (userId === me ? "You" : (detail.data.members.find((member) => member.userId === userId)?.email ?? "Former member"));
  const mine = workspace.ledger?.currency === card.household.currency ? privateExpenses(workspace.ledger, card.id) : [];
  const all: PreviewRow[] = [
    ...expenses.data.map((expense) => ({ id: expense.id, title: expense.title, paidBy: name(expense.payerUserId), yours: me ? (expense.splits.find((split) => split.userId === me)?.amountCents ?? 0) : 0 })),
    ...mine.map((entry) => ({ id: entry.id, title: entry.title, paidBy: "You", yours: entry.share, only: true })),
  ];
  const rows = all.slice(0, PREVIEW_ROWS);
  return <TripExpenseTable rows={rows} currency={card.household.currency} more={all.length - rows.length} />;
}

function SharedHeroStats({ card }: { card: Extract<TripCard, { kind: "shared" }> }) {
  const email = useAccountEmail();
  const workspace = useLedgerWorkspace();
  const detail = useQuery(householdDetailQuery(email, card.id));
  const expenses = useQuery(householdExpensesQuery(email, card.id));
  if (!detail.data || !expenses.data) return <p className="muted">{expenses.isError || detail.isError ? "Open the trip to see its totals." : "Loading the trip's totals…"}</p>;
  const me = findMe(detail.data.members, email)?.userId;
  const totals = sharedTripTotals(expenses.data, me, privateExpenses(workspace.ledger, card.id), card);
  const money = (cents: number) => formatCents(cents, card.household.currency);
  return (
    <dl className="trip-stats">
      <div>
        <dt>Trip total</dt>
        <dd className="pk-num">{money(totals.tripTotal)}</dd>
      </div>
      <div>
        <dt>Your spending</dt>
        <dd className="pk-num">{money(totals.yourSpending)}</dd>
      </div>
    </dl>
  );
}
