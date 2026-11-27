import type { Ledger } from "@domain/ledger.ts";
import type { YearReview } from "@domain/yearReview.ts";
import { useNavigate } from "@tanstack/react-router";
import { useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useAccountEmail, useAccountMe } from "../../auth/account";
import { useOpenAddEntry, usePageTitle, useTopbarSlot } from "../../app/shell/pageTitle";
import { useToday } from "../../app/useToday";
import { tileStyle } from "../../design/categoryTint";
import { Avatar, Button, cx } from "../../design/controls";
import { CardGlyph, Icon, SparklesIcon } from "../../design/Icon";
import { formatWhole } from "../../design/Money";
import { motionMode, play, useCountUp, usePeriodSlide } from "../../design/motion";
import { Banner, LoadingState } from "../../design/states";
import { categoryIcon } from "../entries/model";
import { busiestTitle, countedIn, facts, leadTitle, latestReviewYear, monthColumns, monthName, payerAvatarName, payerLabel, reviewYear, sharedTitle, tripLine, tripName, tripsTitle, type YearReviewSearch } from "./model";
import { ShareDialog } from "./ShareDialog";
import { useYearReview, type ReviewHousehold } from "./useYearReview";

/**
 * The year in review (`/insights/year-review?year=`, MAZ-292 phase 2; card `web-year-review`).
 * Opened from Insights' year card (December 26 to January 31) and the January banner. Every
 * number comes from the shared rule `yearReview` (`src/domain/yearReview.ts`); the page adds the
 * names of trips and households, which the share image never carries.
 *
 * From 1100px the card's grid: top categories beside the busiest month, then trips, who paid and
 * a few things about your year. Narrower windows stack the same panels in that order. The web
 * shows the year on one page, so it has no paging (docs/design/motion.md §7).
 *
 * Motion: the year's total and the counts count up from 0 the first time the year appears; the
 * category bars, Who paid bars and the month columns grow from zero together. Under reduced
 * motion the final values show at once. Assistive technology hears the final values only.
 */
export function YearReviewPage({ search }: { search: YearReviewSearch }) {
  const navigateTo = useNavigate({ from: "/insights/year-review" });
  const today = useToday();
  const year = reviewYear(search.year, today);
  const latest = latestReviewYear(today);
  usePageTitle(`${year} in review`);
  const content = useRef<HTMLDivElement>(null);
  usePeriodSlide(content, year);
  const { view, review, households, sharedMissing, retry } = useYearReview(year);
  const [sharing, setSharing] = useState(false);
  const ready = Boolean(view && review && !review.empty);

  return (
    <div ref={content} className="page year-review">
      <div className="glow" aria-hidden="true" />
      <YearBar
        year={year}
        max={latest}
        onChange={(next) => {
          void navigateTo({ search: next !== latest ? { year: Number(next) } : {} });
        }}
        onShare={
          ready
            ? () => {
                setSharing(true);
              }
            : null
        }
      />
      {!view || !review ? (
        <LoadingState label="Loading your year…" />
      ) : review.empty ? (
        <NothingToReview year={year} />
      ) : (
        <>
          {sharedMissing ? (
            <Banner
              tone="warning"
              title="Shared expenses may be missing"
              action={
                <Button variant="quiet" onClick={retry}>
                  Retry
                </Button>
              }
            >
              Penny couldn't load your households. This year counts your own entries.
            </Banner>
          ) : null}
          <Year review={review} view={view} households={households} />
        </>
      )}
      {sharing && review && view ? (
        <ShareDialog
          review={review}
          currency={view.currency}
          onClose={() => {
            setSharing(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** The year control (‹ 2026 ›) and Share your year, in the top bar beside the title (`web-year-review`). */
function YearBar({ year, max, onChange, onShare }: { year: string; max: string; onChange: (year: string) => void; onShare: (() => void) | null }) {
  const slot = useTopbarSlot();
  const step = (delta: number) => String(Number(year) + delta);
  const bar = (
    <div className="year-bar">
      <div className="year-nav">
        <Button
          iconOnly
          icon="chevron-back"
          variant="quiet"
          className="year-nav__step"
          aria-label="Previous year"
          disabled={year <= "2000"}
          onClick={() => {
            onChange(step(-1));
          }}
        />
        <span className="year-nav__label pk-num" aria-live="polite">
          {year}
        </span>
        <Button
          iconOnly
          icon="chevron-forward"
          variant="quiet"
          className="year-nav__step"
          aria-label="Next year"
          disabled={year >= max}
          onClick={() => {
            onChange(step(1));
          }}
        />
      </div>
      {onShare ? (
        <button type="button" className="wbtn wbtn--primary year-bar__share" onClick={onShare}>
          <CardGlyph name="share" size={16} weight={40} />
          Share your year
        </button>
      ) : null}
    </div>
  );
  return slot ? createPortal(bar, slot) : <div className="month-bar__inline">{bar}</div>;
}

/** Grows every bar and column in `container` from zero together the first time the year appears (no stagger). */
function useBarsGrowIn(container: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const mode = motionMode();
    if (mode !== "full") return;
    for (const bar of element.querySelectorAll("[data-bar]")) play(bar, [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: "emphasized", mode });
    for (const column of element.querySelectorAll("[data-column]")) play(column, [{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], { duration: "emphasized", mode });
  }, [container]);
}

/** A count that counts up from 0 the first time it appears; assistive technology hears the final value only. */
function Count({ value, format = String }: { value: number; format?: (value: number) => string }) {
  const { value: shown, counting } = useCountUp(value, 0);
  if (!counting) return <span className="pk-num">{format(value)}</span>;
  return (
    <span className="pk-num">
      <span aria-hidden="true">{format(shown)}</span>
      <span className="visually-hidden">{format(value)}</span>
    </span>
  );
}

function Year({ review, view, households }: { review: YearReview; view: Ledger; households: readonly ReviewHousehold[] }) {
  const body = useRef<HTMLDivElement>(null);
  useBarsGrowIn(body);
  const currency = view.currency;
  return (
    <div ref={body} className="year-review__grid">
      <CategoriesPanel review={review} currency={currency} />
      <MonthsPanel review={review} currency={currency} />
      {review.trips.list.length ? <TripsPanel review={review} view={view} households={households} currency={currency} /> : null}
      {review.shared.count ? <WhoPaidPanel review={review} households={households} currency={currency} /> : null}
      <FactsPanel review={review} />
    </div>
  );
}

function Panel({ title, note, className, children, labelled }: { title?: ReactNode; note?: ReactNode; className?: string; children: ReactNode; labelled?: string }) {
  const id = useId();
  return (
    <section className={cx("card recap-panel year-panel", className)} aria-labelledby={labelled ?? id}>
      {title ? (
        <div className="recap-panel__head">
          <h2 id={id} className="panel__title">
            {title}
          </h2>
          {note ? <span className="recap-panel__note pk-num">{note}</span> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function CategoriesPanel({ review, currency }: { review: YearReview; currency: string }) {
  const id = useId();
  const lead = leadTitle(review);
  const money = (cents: number) => formatWhole(cents, currency);
  return (
    <Panel className="year-lead" labelled={id}>
      <h2 id={id} className="year-lead__title">
        {lead ?? `Your ${review.year}`}
      </h2>
      <p className="year-lead__text">
        You spent{" "}
        <strong>
          <Count value={review.spent} format={money} />
        </strong>{" "}
        in {review.year}
        {review.shared.count ? ", your share of shared expenses included." : "."}
      </p>
      {review.topCategories.length ? (
        <ol className="year-rank">
          {review.topCategories.map((category, index) => (
            <li key={category.key} className="year-rank__row">
              <span className="year-rank__n pk-num" aria-hidden="true">
                {index + 1}
              </span>
              <span className="category-dot" style={tileStyle(category)}>
                <Icon name={categoryIcon(category.icon)} size={16} />
              </span>
              <span className="year-rank__name">
                {category.name}
                <span className="year-bar-track" aria-hidden="true">
                  <i data-bar="" style={{ width: `${String(category.share)}%`, ...tileStyle(category) }} />
                </span>
              </span>
              <span className="year-rank__value pk-num">
                {money(category.amount)}
                <span>{category.share}%</span>
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </Panel>
  );
}

function MonthsPanel({ review, currency }: { review: YearReview; currency: string }) {
  const title = busiestTitle(review);
  const money = (cents: number) => formatWhole(cents, currency);
  const note = review.busiestMonth ? `${money(review.busiestMonth.spent)} spent · the year averaged ${money(review.monthlyAverage)} a month` : null;
  return (
    <Panel title={title ?? "Busiest month"} note={note} className="year-months">
      <ol className="year-columns" aria-label="Spent each month">
        {monthColumns(review).map((column) => (
          <li key={column.month} className={cx("year-columns__month", column.busiest && "year-columns__month--busiest")}>
            <span className="year-columns__track" aria-hidden="true">
              <i data-column="" style={{ height: `${String(Math.max(column.height, column.spent > 0 ? 2 : 0))}%` }} />
            </span>
            <span aria-hidden="true">{column.label}</span>
            <span className="visually-hidden">
              {monthName(column.month)}: {money(column.spent)}
              {column.busiest ? ", the busiest month" : ""}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function TripsPanel({ review, view, households, currency }: { review: YearReview; view: Ledger; households: readonly ReviewHousehold[]; currency: string }) {
  const money = (cents: number) => formatWhole(cents, currency);
  return (
    <Panel title={tripsTitle(review)} note={`${money(review.trips.share)} your share`} className="year-trips">
      <ul className="year-list">
        {review.trips.list.map((trip) => (
          <li key={`${trip.kind}:${trip.id}`} className="year-list__row">
            <span className="year-list__icon" aria-hidden="true">
              <Icon name="airplane" size={16} />
            </span>
            <span className="year-list__text">
              <strong>{tripName(trip, view, households) ?? "A trip"}</strong>
              <span>{tripLine(trip)}</span>
            </span>
            <span className="year-list__value pk-num">
              {money(trip.share)}
              <span>{trip.days === 1 ? "1 day" : `${String(trip.days)} days`}</span>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function WhoPaidPanel({ review, households, currency }: { review: YearReview; households: readonly ReviewHousehold[]; currency: string }) {
  const { shared } = review;
  // Your row's avatar is yours, in copper (`web-year-review`); the label says "You".
  const email = useAccountEmail();
  const me = useAccountMe();
  return (
    <Panel title="Who paid" note={sharedTitle(shared.count)} className="year-paid">
      <ul className="year-rank">
        {shared.payers.map((payer) => {
          const name = payerLabel(payer);
          return (
            <li key={payer.key} className="year-rank__row">
              {payer.you ? (
                <span className="year-avatar year-avatar--you" aria-hidden="true">
                  <Avatar name={me.displayName ?? email} size={30} />
                </span>
              ) : payer.payer?.deleted ? (
                <span className="year-avatar year-avatar--gone" aria-hidden="true">
                  <Icon name="people" size={15} />
                </span>
              ) : (
                <span className="year-avatar" aria-hidden="true">
                  <Avatar name={payerAvatarName(payer.payer)} size={30} />
                </span>
              )}
              <span className="year-rank__name">
                {name}
                <span className={cx("year-bar-track", payer.you && "year-bar-track--you")} aria-hidden="true">
                  <i data-bar="" style={{ width: `${String((payer.count / shared.count) * 100)}%` }} />
                </span>
              </span>
              <span className="year-rank__value pk-num">
                <Count value={payer.count} />
              </span>
            </li>
          );
        })}
      </ul>
      <p className="year-foot">
        {countedIn(review, households)}
        {shared.othersPaid > 0 ? (
          <>
            {" "}
            Others paid <strong className="pk-num">{formatWhole(shared.othersPaid, currency)}</strong> of the ones you split.
          </>
        ) : null}
      </p>
    </Panel>
  );
}

function FactsPanel({ review }: { review: YearReview }) {
  const list = facts(review);
  return (
    <Panel title="A few things about your year" className="year-facts">
      <ul className="year-facts__grid">
        {list.map((fact) => (
          <li key={fact.key} className="year-fact">
            <strong>{/^\d+$/.test(fact.value) ? <Count value={Number(fact.value)} /> : fact.value}</strong>
            {fact.label}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** A year with no recorded entry (scheduled ones don't count), as the recap's empty state. */
function NothingToReview({ year }: { year: string }) {
  const addEntry = useOpenAddEntry();
  const titleId = useId();
  return (
    <section className="card recap-empty" aria-labelledby={titleId}>
      <span className="recap-empty__icon" aria-hidden="true">
        <SparklesIcon size={32} />
      </span>
      <h2 id={titleId} className="recap-empty__title">
        Nothing to review yet
      </h2>
      <p className="recap-empty__text">A year in review needs at least one recorded entry, and {year} has none. Scheduled entries count once they're recorded.</p>
      <div className="recap-empty__actions">
        {addEntry ? (
          <Button variant="primary" icon="add" onClick={addEntry}>
            Add an entry
          </Button>
        ) : null}
        <Button
          variant="secondary"
          onClick={() => {
            document.querySelector<HTMLButtonElement>(".year-nav__step[aria-label='Previous year']")?.focus();
          }}
        >
          Choose another year
        </Button>
      </div>
    </section>
  );
}
