import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ApiError } from "../../api/client";
import { householdDetailQuery, householdExpensesQuery, householdsQuery } from "../../api/households";
import { useAccountEmail } from "../../auth/account";
import { useIsDemo } from "../../demo/demo";
import { Badge, Button } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { formatCents, Money } from "../../design/Money";
import { Banner, EmptyState, ErrorState, LoadingState } from "../../design/states";
import { EntryFormDialog } from "../entries/EntryForm";
import { findMe } from "../households/model";
import { JoinTripDialog } from "../households/StartDialogs";
import { useLedgerWorkspace } from "../organize/workspace";
import { featuredTrip, phaseLabel, privateExpenses, rangeLabel, sharedTripTotals, tripCards, type TripCard } from "./model";
import { TripFormDialog } from "./TripForm";

/**
 * Trips (specimen `trips`, card `web-trips`): the trip happening now or coming next, then every
 * trip, personal and shared, newest first. Personal trips come from this browser's ledger (offline
 * first); shared trips from the server. A personal trip that was shared shows once, as the shared
 * trip. New trip and Join a trip are the two ways in.
 */
export function TripsPage() {
  const email = useAccountEmail();
  const demo = useIsDemo();
  const workspace = useLedgerWorkspace();
  const households = useQuery({ ...householdsQuery(email), enabled: !demo });
  const [dialog, setDialog] = useState<"new" | "join" | null>(null);
  const [tripExpense, setTripExpense] = useState<string | null>(null);
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

  return (
    <div className="page trips">
      <div className="trips__intro">
        <p className="organize__lede">Keep travel spending together, even what you pay before or after the trip.</p>
        <div className="shared-actions">
          <Button variant="primary" icon="add" onClick={() => { setDialog("new"); }}>
            New trip
          </Button>
          {demo ? null : (
            <Button icon="key" onClick={() => { setDialog("join"); }}>
              Join a trip
            </Button>
          )}
        </div>
      </div>

      {sharedUnavailable ? (
        <Banner tone="info" title="Shared trips aren't available" action={households.isError && !demo ? <Button variant="quiet" onClick={() => void households.refetch()}>Try again</Button> : undefined}>
          {sharedUnavailable}
        </Banner>
      ) : null}

      {cards.length === 0 && !households.isLoading ? (
        <EmptyState icon="airplane" title="Your next trip starts here">
          <p>Create a trip, then assign expenses to see its total. Share it to split costs with the people you travel with.</p>
        </EmptyState>
      ) : null}

      {featured ? (
        <FeaturedTrip
          card={featured}
          currency={currency}
          onTripExpense={() => {
            setTripExpense(featured.id);
          }}
        />
      ) : null}

      {rest.length || cards.length ? (
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
      ) : null}

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

/** The trip happening now or next, with its numbers and the contextual add action. */
function FeaturedTrip({ card, currency, onTripExpense }: { card: TripCard; currency: string | undefined; onTripExpense: () => void }) {
  const navigate = useNavigate();
  return (
    <section className="trip-hero" aria-labelledby="trip-hero-name">
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
    </section>
  );
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
