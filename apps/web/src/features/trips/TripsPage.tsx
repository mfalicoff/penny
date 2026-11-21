import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useId, useMemo, useState } from "react";
import { ApiError } from "../../api/client";
import { householdsQuery } from "../../api/households";
import { useMediaQuery, WIDE } from "../../app/useMediaQuery";
import { useAccountEmail } from "../../auth/account";
import { useIsDemo } from "../../demo/demo";
import { tileStyle } from "../../design/categoryTint";
import { Avatar, Badge, Button } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { formatCents, Money } from "../../design/Money";
import { Banner, EmptyState, ErrorState, LoadingState } from "../../design/states";
import { EntryFormDialog } from "../entries/EntryForm";
import { categoryIcon } from "../entries/model";
import { GroupToolbar, ToolButton } from "../households/GroupTools";
import { JoinTripDialog } from "../households/StartDialogs";
import { useLedgerWorkspace } from "../organize/workspace";
import { featuredTrip, paidByCell, peopleCount, phaseLabel, tileStatus, tripPhase, tripCards, tripOverview, tripRange, tripSections, type TripCard } from "./model";
import { TripFormDialog } from "./TripForm";
import { useSharedTripNumbers } from "./useSharedTrip";

type PersonalCard = Extract<TripCard, { kind: "personal" }>;
type SharedCard = Extract<TripCard, { kind: "shared" }>;

/**
 * Trips (cards `iphone-trips`, `web-trips`): the trip happening now or coming next, then the
 * others. Phones and tablets show the featured trip as a card that opens it (the countdown, the
 * people and your share so far), then UPCOMING and PAST rows; from 1100px it shows the trip total,
 * your share and what you owe beside its expenses, then a grid of tiles ending with New trip.
 * Personal trips come from this browser's ledger (offline first); shared trips from the server. A
 * personal trip that was shared shows once, as the shared trip. Join a trip (key) and New trip (+)
 * are the navigation bar's icons (MAZ-229); from 1100px the key sits beside the title and New trip
 * is the tile (MAZ-263).
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
  const allId = useId();

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
  const join = demo ? null : <ToolButton icon="key" label="Join a trip" onClick={() => { setDialog("join"); }} />;
  const sections = tripSections(rest);

  return (
    <div className="page trips">
      {/* From 1100px the key sits beside the title (card `web-trips`); narrower, it's the bar's first icon (`iphone-trips`). */}
      <GroupToolbar lead={wide && join ? join : null}>
        {wide ? null : join}
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
        wide ? (
          <FeaturedTrip
            card={featured}
            currency={currency}
            onTripExpense={() => {
              setTripExpense(featured.id);
            }}
          />
        ) : (
          <FeaturedTripCard card={featured} currency={currency} />
        )
      ) : null}

      {!wide ? (
        <>
          {sections.upcoming.length ? <TripList id="trips-upcoming" title="Upcoming" cards={sections.upcoming} currency={currency} /> : null}
          {sections.past.length ? <TripList id="trips-past" title="Past" cards={sections.past} currency={currency} /> : null}
        </>
      ) : (
        <section className="trip-grid-section" aria-labelledby={allId}>
          {/* The card shows the tiles without a heading; it stays for screen readers. */}
          <h2 id={allId} className="visually-hidden">
            {featured ? "All trips" : "Trips"}
          </h2>
          <ul className="trip-grid">
            {rest.map((card) => (
              <li key={`${card.kind}-${card.id}`}>
                <TripTile card={card} currency={currency} />
              </li>
            ))}
            <li>
              <button type="button" className="trip-tile trip-tile--new" onClick={() => { setDialog("new"); }}>
                <Icon name="add" size={16} />
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

/** "Personal", "Personal · was shared" or "Shared": the trip's kind in words, never color alone. */
function kindLabel(card: TripCard) {
  if (card.kind === "shared") return "Shared";
  return card.wasShared ? "Personal · was shared" : "Personal";
}

/** Your share of a shared trip (your splits plus your private expenses), once it has loaded. */
function SharedShare({ card }: { card: SharedCard }) {
  const numbers = useSharedTripNumbers(card.household);
  if (numbers.totals) return <Money cents={numbers.totals.yourSpending} currency={card.household.currency} />;
  return <span className="muted">{numbers.failed ? "Open for totals" : "…"}</span>;
}

/** A tile in the grid from 1100px (card `web-trips`): icon and kind, name, dates and status, your share. */
function TripTile({ card, currency }: { card: TripCard; currency: string | undefined }) {
  const status = tileStatus(card);
  return (
    <Link to="/trips/$id" params={{ id: card.id }} className="trip-tile">
      <span className="trip-tile__top">
        <span className="trip-tile__icon" aria-hidden="true">
          <Icon name="airplane" />
        </span>
        {card.kind === "shared" && tripPhase(card) === "past" ? <PastSharedBadge card={card} /> : <Badge>{kindLabel(card)}</Badge>}
      </span>
      <span className="trip-tile__name">{card.name}</span>
      <span className="trip-tile__meta">
        {tripRange(card.startDate, card.endDate)}
        {status ? ` · ${status}` : ""}
      </span>
      <span className="trip-tile__amount">{card.kind === "personal" ? <Money cents={card.total} currency={currency} /> : <SharedShare card={card} />}</span>
    </Link>
  );
}

/** A past shared trip's pill (card `web-trips`): the green Settled once nobody owes anything, else Shared. */
function PastSharedBadge({ card }: { card: SharedCard }) {
  const { settled } = useSharedTripNumbers(card.household, { settled: true });
  return settled ? (
    <Badge tone="income" icon="checkmark">
      Settled
    </Badge>
  ) : (
    <Badge>{kindLabel(card)}</Badge>
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
                  {tripRange(card.startDate, card.endDate, { year: "auto" })} <Badge>{card.kind === "shared" ? "Shared" : "Personal"}</Badge>
                </span>
              </span>
              <span className="row__end trip-list-row__end">
                {card.kind === "personal" ? <Money cents={card.total} currency={currency} /> : <SharedShare card={card} />}
                <Icon name="chevron-forward" size={16} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The featured trip on phones and tablets (card `iphone-trips`): the countdown as an amber
 * eyebrow, the name, the dates and people, the members' avatars, and one number, your share so
 * far. The whole card opens the trip; a trip expense is added from Add entry or the trip.
 */
function FeaturedTripCard({ card, currency }: { card: TripCard; currency: string | undefined }) {
  return (
    <section className="trip-hero trip-hero--card" aria-labelledby="trip-hero-name">
      <Link to="/trips/$id" params={{ id: card.id }} className="trip-hero__open">
        <span className="trip-hero__top">
          <span className="trip-hero__heading">
            <span className="trip-hero__when">{phaseLabel(card)}</span>
            <h2 id="trip-hero-name" className="trip-hero__name">
              {card.name}
            </h2>
            <span className="trip-hero__meta">
              {tripRange(card.startDate, card.endDate, { year: "auto" })}
              {card.kind === "shared" ? ` · ${peopleCount(card.household.memberCount)}` : ""}
            </span>
          </span>
          {card.kind === "shared" ? <SharedAvatars card={card} /> : null}
        </span>
        <span className="trip-hero__bottom">
          <span className="trip-hero__lead">
            Your share so far
            {card.kind === "personal" ? <Money cents={card.total} currency={currency} /> : <SharedShare card={card} />}
          </span>
          <Badge icon={card.kind === "shared" ? "people" : "lock-closed"}>{kindLabel(card)}</Badge>
        </span>
      </Link>
    </section>
  );
}

function SharedAvatars({ card }: { card: SharedCard }) {
  const { members } = useSharedTripNumbers(card.household);
  if (!members.length) return null;
  return (
    <span className="avatars trip-hero__people" aria-hidden="true">
      {members.slice(0, 5).map((member) => (
        <Avatar key={member.userId} name={member.email} size={34} />
      ))}
    </span>
  );
}

/**
 * The featured trip from 1100px (card `web-trips`): one pill with the countdown and kind, the
 * name, the dates and people, the trip total, your share and what you owe this month, Trip
 * expense and Open trip, and its expenses on the right.
 */
function FeaturedTrip({ card, currency, onTripExpense }: { card: TripCard; currency: string | undefined; onTripExpense: () => void }) {
  const navigate = useNavigate();
  return (
    <section className="trip-hero trip-hero--with-expenses" aria-labelledby="trip-hero-name">
      <div className="trip-hero__main">
        <Badge>
          {phaseLabel(card)} · {card.kind === "shared" ? "Shared" : "Personal"}
        </Badge>
        <h2 id="trip-hero-name" className="trip-hero__name">
          {card.name}
        </h2>
        <p className="trip-hero__meta">
          {tripRange(card.startDate, card.endDate)}
          {card.kind === "shared" ? ` · ${peopleCount(card.household.memberCount)}` : ""}
        </p>
        {card.kind === "personal" ? <PersonalStats card={card} /> : <SharedStats card={card} />}
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
      {card.kind === "personal" ? <PersonalTripExpenses card={card} currency={currency} /> : <SharedTripExpenses card={card} />}
    </section>
  );
}

function PersonalStats({ card }: { card: PersonalCard }) {
  const workspace = useLedgerWorkspace();
  const ledger = workspace.ledger;
  const overview = ledger ? tripOverview(ledger, card.trip) : null;
  return (
    <dl className="trip-stats">
      <div>
        <dt>Trip total</dt>
        <dd>
          <Money cents={overview?.receiptTotal ?? card.total} currency={ledger?.currency} />
        </dd>
      </div>
      <div>
        <dt>Your share</dt>
        <dd>
          <Money cents={card.total} currency={ledger?.currency} />
        </dd>
      </div>
    </dl>
  );
}

function SharedStats({ card }: { card: SharedCard }) {
  const numbers = useSharedTripNumbers(card.household, { balance: true });
  if (!numbers.totals) return <p className="muted">{numbers.failed ? "Open the trip to see its totals." : "Loading the trip's totals…"}</p>;
  const money = (cents: number) => formatCents(cents, card.household.currency);
  const balance = numbers.balance ?? 0;
  return (
    <dl className="trip-stats">
      <div>
        <dt>Trip total</dt>
        <dd className="pk-num">{money(numbers.totals.tripTotal)}</dd>
      </div>
      <div>
        <dt>Your share</dt>
        <dd className="pk-num">{money(numbers.totals.yourSpending)}</dd>
      </div>
      <div>
        <dt>{balance > 0 ? "You're owed" : "You owe"}</dt>
        <dd className="pk-num">{numbers.balanceLoading ? "…" : money(Math.abs(balance))}</dd>
      </div>
    </dl>
  );
}

interface PreviewRow {
  id: string;
  title: string;
  category: { icon: string; color: string } | undefined;
  paidBy: string;
  yours: number;
  only?: boolean;
}

const PREVIEW_ROWS = 5;

/** The featured trip's expenses from 1100px (card `web-trips`): what each was, who paid and your part. */
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
                <span className="trip-expense-table__title">
                  <span className="category-dot" style={tileStyle(row.category)} aria-hidden="true">
                    <Icon name={categoryIcon(row.category?.icon)} size={18} />
                  </span>
                  <span>{row.title}</span>
                  {row.only ? <Badge icon="lock-closed">Only you</Badge> : null}
                </span>
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

function PersonalTripExpenses({ card, currency }: { card: PersonalCard; currency: string | undefined }) {
  const workspace = useLedgerWorkspace();
  const ledger = workspace.ledger;
  if (!ledger) return null;
  const all = tripOverview(ledger, card.trip).expenses;
  const rows = all.slice(0, PREVIEW_ROWS).map((entry) => ({
    id: entry.id,
    title: entry.title,
    category: ledger.categories.find((category) => category.id === entry.categoryId),
    paidBy: "You",
    yours: entry.share,
  }));
  return <TripExpenseTable rows={rows} currency={currency} more={all.length - rows.length} />;
}

function SharedTripExpenses({ card }: { card: SharedCard }) {
  const workspace = useLedgerWorkspace();
  const numbers = useSharedTripNumbers(card.household);
  const detail = numbers.detail.data;
  const expenses = numbers.expenses.data;
  if (!detail || !expenses) return <p className="muted trip-hero__expenses">{numbers.failed ? "Open the trip to see its expenses." : "Loading the trip's expenses…"}</p>;
  const me = numbers.me;
  const name = (userId: string) => (userId === me ? "You" : (detail.members.find((member) => member.userId === userId)?.email ?? "Former member"));
  const all: PreviewRow[] = [
    // Oldest first, as the card lists the trip's expenses; your private ones follow.
    ...[...expenses].sort((x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id)).map((expense) => ({
      id: expense.id,
      title: expense.title,
      category: expense.category,
      paidBy: paidByCell(expense, me, name(expense.payerUserId)),
      yours: me ? (expense.splits.find((split) => split.userId === me)?.amountCents ?? 0) : 0,
    })),
    ...[...numbers.mine].sort((x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id)).map((entry) => ({
      id: entry.id,
      title: entry.title,
      category: workspace.ledger?.categories.find((category) => category.id === entry.categoryId),
      paidBy: "You",
      yours: entry.share,
      only: true,
    })),
  ];
  const rows = all.slice(0, PREVIEW_ROWS);
  return <TripExpenseTable rows={rows} currency={card.household.currency} more={all.length - rows.length} />;
}
