import type { Ledger } from "@domain/ledger.ts";
import type { MonthReview } from "@domain/monthReview.ts";
import { useNavigate } from "@tanstack/react-router";
import { useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { useOpenAddEntry, usePageTitle } from "../../app/shell/pageTitle";
import { TABLET, useMediaQuery } from "../../app/useMediaQuery";
import { useToday } from "../../app/useToday";
import { ownTileStyle } from "../../design/categoryTint";
import { Button, cx } from "../../design/controls";
import { Icon, SparklesIcon } from "../../design/Icon";
import { formatCents, formatWhole, HeroMoney, Money } from "../../design/Money";
import { motionMode, play, usePeriodSlide } from "../../design/motion";
import { Banner, LoadingState } from "../../design/states";
import { categoryIcon } from "../entries/model";
import { MonthBar } from "../home/parts";
import { changeChip, changeWords, compareBars, flowParts, householdOf, latestRecapMonth, longestRunLine, monthName, paidBy, quietDaysTitle, recapMonth, spentSentence, type RecapSearch } from "./model";
import { useMonthReview } from "./useMonthReview";

/**
 * The monthly recap (`/insights/recap?month=`, MAZ-292; cards `web-recap`, `web-recap-empty`).
 * Opened from the recap banner on Home and Insights, or Insights' Recap button, for any past
 * month. Every number comes from the shared rule `monthReview` (`src/domain/monthReview.ts`).
 *
 * From 1100px (`web-recap`): spent with its comparison bars beside Money in and out, then Biggest
 * changes beside Shared and Highlights. Narrower windows stack the same panels in that order, and
 * below 768px Biggest changes is a list, as on `iphone-recap`.
 *
 * Motion (docs/design/motion.md §7): the totals count up from 0 the first time a recap appears
 * and from the old value when the month changes; the bars grow together from zero, then move to
 * their new lengths. Assistive technology hears the final values only.
 */
export function RecapPage({ search }: { search: RecapSearch }) {
  const navigateTo = useNavigate({ from: "/insights/recap" });
  const today = useToday();
  const month = recapMonth(search.month, today);
  const latest = latestRecapMonth(today);
  usePageTitle(`${monthName(month)} recap`);
  const content = useRef<HTMLDivElement>(null);
  usePeriodSlide(content, month);
  const { view, review, sharedMissing, retry } = useMonthReview(month);
  const tablet = useMediaQuery(TABLET);

  return (
    <div ref={content} className="page recap">
      <MonthBar
        month={month}
        max={latest}
        onChange={(next) => {
          void navigateTo({ search: next && next !== latest ? { month: next } : {} });
        }}
      />
      {/* iphone-recap: the subtitle under the title says what the recap counts. */}
      {tablet ? null : <p className="page__subtitle">Recorded entries · your share</p>}
      {!view || !review ? (
        <LoadingState label="Loading your recap…" />
      ) : review.empty ? (
        <NothingToRecap month={month} />
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
              Penny couldn't load your households. This recap counts your own entries.
            </Banner>
          ) : null}
          <Recap review={review} view={view} />
        </>
      )}
    </div>
  );
}

/** Grows every bar in `container` from zero together, the first time the recap appears (no stagger); labels fade in with them. */
function useBarsGrowIn(container: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const mode = motionMode();
    if (mode !== "full") return;
    for (const bar of element.querySelectorAll("[data-bar]")) play(bar, [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: "emphasized", mode });
    for (const label of element.querySelectorAll("[data-bar-label]")) play(label, [{ opacity: 0 }, { opacity: 1 }], { duration: "emphasized", mode });
  }, [container]);
}

function Recap({ review, view }: { review: MonthReview; view: Ledger }) {
  const currency = view.currency;
  const wide = useMediaQuery(TABLET);
  const body = useRef<HTMLDivElement>(null);
  useBarsGrowIn(body);
  return (
    <div ref={body} className="recap__body">
      <div className="recap__hero">
        <SpentPanel review={review} currency={currency} />
        <FlowPanel review={review} currency={currency} />
      </div>
      <div className="recap__low">
        <ChangesPanel review={review} currency={currency} table={wide} />
        <div className="recap__side">
          <SharedPanel review={review} view={view} currency={currency} />
          <HighlightsPanel review={review} />
        </div>
      </div>
    </div>
  );
}

function RecapPanel({ title, action, className, children, titleHidden }: { title: ReactNode; action?: ReactNode; className?: string; children: ReactNode; titleHidden?: boolean }) {
  const id = useId();
  return (
    <section className={cx("card recap-panel", className)} aria-labelledby={id}>
      <div className={cx("recap-panel__head", titleHidden && "recap-panel__head--eyebrow")}>
        <h2 id={id} className={titleHidden ? "recap-eyebrow" : "panel__title"}>
          {title}
        </h2>
        {action ? <span className="recap-panel__note">{action}</span> : null}
      </div>
      {children}
    </section>
  );
}

function SpentPanel({ review, currency }: { review: MonthReview; currency: string }) {
  const sentence = spentSentence(review);
  return (
    <RecapPanel
      title={
        <>
          Spent<span className="recap-spent__share"> · your share</span>
        </>
      }
      titleHidden
      className="recap-spent"
    >
      <p className="recap-spent__amount">
        <HeroMoney cents={review.spent} currency={currency} countFrom={0} />
      </p>
      {sentence ? (
        <p className="recap-spent__sentence">
          <strong>{sentence.lead}</strong>
          {sentence.rest}
        </p>
      ) : null}
      <dl className="recap-compare">
        {compareBars(review).map((bar) => (
          <div key={bar.key} className={cx("recap-compare__row", bar.key === "current" && "recap-compare__row--current")}>
            <dt>{bar.label}</dt>
            {bar.spent === null ? (
              <dd className="recap-compare__missing" data-bar-label="">
                {bar.missing}
              </dd>
            ) : (
              <dd>
                <span className="recap-compare__track" aria-hidden="true">
                  <i data-bar="" style={{ width: `${String(bar.width)}%` }} />
                </span>
                <span className="pk-num recap-compare__value">{formatWhole(bar.spent, currency)}</span>
              </dd>
            )}
          </div>
        ))}
      </dl>
    </RecapPanel>
  );
}

/** A Money in and out total: counting on wider screens; whole units in the phone legend (iphone-recap: "Invested $200"). */
function FlowAmount({ cents, currency, legend }: { cents: number; currency: string; legend: boolean }) {
  if (legend) return <span className="pk-num money">{formatWhole(cents, currency)}</span>;
  return <Money count countFrom={0} cents={cents} currency={currency} />;
}

function FlowPanel({ review, currency }: { review: MonthReview; currency: string }) {
  const parts = flowParts(review);
  // Below 768px the totals are a one-line legend under the bar, as on iphone-recap.
  const legend = !useMediaQuery(TABLET);
  const overspent = review.leftOver < 0;
  return (
    <RecapPanel
      title="Money in and out"
      className="recap-flow"
      action={
        <>
          Came in{" "}
          <strong>
            <Money count countFrom={0} cents={review.cameIn} currency={currency} />
          </strong>
        </>
      }
    >
      <div className="recap-flow__bar" aria-hidden="true">
        {parts.spent > 0 ? <i data-bar="" className="recap-flow__spent" style={{ width: `${String(parts.spent)}%` }} /> : null}
        {parts.invested > 0 ? <i data-bar="" className="recap-flow__invested" style={{ width: `${String(parts.invested)}%` }} /> : null}
        {parts.leftOver > 0 ? <i data-bar="" className="recap-flow__left" style={{ width: `${String(parts.leftOver)}%` }} /> : null}
      </div>
      <dl className="recap-flow__stats">
        <div className="recap-stat">
          <dt>
            <span className="tile__dot tile__dot--expense" />
            Spent
          </dt>
          {/* iphone-recap's legend names Spent without its amount, which leads the recap above. */}
          <dd className="recap-stat__spent">
            <FlowAmount cents={review.spent} currency={currency} legend={legend} />
          </dd>
        </div>
        <div className="recap-stat">
          <dt>
            <span className="tile__dot tile__dot--investment" />
            Invested
          </dt>
          <dd>
            <FlowAmount cents={review.invested} currency={currency} legend={legend} />
          </dd>
        </div>
        <div className="recap-stat">
          <dt>
            <span className={cx("tile__dot", overspent ? "tile__dot--danger" : "tile__dot--income")} />
            {overspent ? "Overspent" : "Left over"}
          </dt>
          <dd className={overspent ? "recap-stat__over" : "recap-stat__left"}>
            <FlowAmount cents={Math.abs(review.leftOver)} currency={currency} legend={legend} />
          </dd>
        </div>
      </dl>
    </RecapPanel>
  );
}

function Chip({ percent }: { percent: number | null }) {
  return (
    <span className={cx("recap-chip", percent === null && "recap-chip--new")} data-bar-label={percent === null ? "" : undefined}>
      <span aria-hidden="true">{changeChip(percent)}</span>
      <span className="visually-hidden">{changeWords(percent)}</span>
    </span>
  );
}

function ChangesPanel({ review, currency, table }: { review: MonthReview; currency: string; table: boolean }) {
  const current = monthName(review.month);
  const previous = monthName(review.previous.month);
  const rows = review.biggestChanges;
  const empty = review.previous.spent === null ? `No ${previous} to compare with.` : `Spending by category didn't change from ${previous}.`;
  return (
    <RecapPanel title="Biggest changes" action={`Compared with ${previous}`} className="recap-changes">
      {!rows.length ? (
        <p className="muted recap-changes__empty">{empty}</p>
      ) : table ? (
        <div className="table-scroll">
          <table className="recap-table">
            <caption className="visually-hidden">
              The categories that changed most, {current} compared with {previous}, your share
            </caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col" className="num">
                  {current}
                </th>
                <th scope="col" className="num">
                  {previous}
                </th>
                <th scope="col" className="num">
                  Change
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">
                    <span className="category-compare__name">
                      <span className="category-dot" style={ownTileStyle(row)}>
                        <Icon name={categoryIcon(row.icon)} size={16} />
                      </span>
                      {row.name}
                    </span>
                  </th>
                  <td className="num">
                    <Money cents={row.current} currency={currency} />
                  </td>
                  <td className="num muted">
                    {row.previous ? (
                      <Money cents={row.previous} currency={currency} tone="muted" />
                    ) : (
                      <>
                        <span aria-hidden="true">—</span>
                        <span className="visually-hidden">Nothing</span>
                      </>
                    )}
                  </td>
                  <td className="num">
                    <Chip percent={row.percent} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="recap-list">
          {rows.map((row) => (
            <li key={row.key} className="recap-row">
              <span className="category-dot" style={ownTileStyle(row)}>
                <Icon name={categoryIcon(row.icon)} size={18} />
              </span>
              <span className="recap-row__text">
                <strong>{row.name}</strong>
                <span>{row.previous ? `${formatCents(row.previous, currency)} in ${previous}` : `Nothing in ${previous}`}</span>
              </span>
              <span className="recap-row__value">
                <Money cents={row.current} currency={currency} />
                <Chip percent={row.percent} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </RecapPanel>
  );
}

function SharedPanel({ review, view, currency }: { review: MonthReview; view: Ledger; currency: string }) {
  const { top } = review.shared;
  const { split } = review;
  if (!top && split.count === 0) return null;
  const category = top ? view.categories.find((item) => item.id === top.categoryId) : undefined;
  const household = top ? householdOf(view, top) : null;
  const payer = top ? paidBy(top) : null;
  return (
    <RecapPanel title="Shared" action="Your share" className="recap-shared">
      <ul className="recap-list">
        {top ? (
          <li className="recap-row">
            <span className="category-dot" style={category ? ownTileStyle(category) : undefined}>
              <Icon name={categoryIcon(category?.icon ?? "")} size={17} />
            </span>
            <span className="recap-row__text">
              <strong>{top.title}</strong>
              <span>{["Your top shared expense", household, payer].filter(Boolean).join(" · ")}</span>
            </span>
            <span className="recap-row__value">
              <Money cents={top.share} currency={currency} />
              <span className="recap-row__of">of {formatCents(top.total, currency)}</span>
            </span>
          </li>
        ) : null}
        {split.count > 0 ? (
          <li className="recap-row">
            <span className="recap-row__icon" aria-hidden="true">
              <Icon name="people" size={17} />
            </span>
            <span className="recap-row__text">
              <strong>Others paid {formatCents(split.othersPaid, currency)}</strong>
              <span>of your {formatCents(split.total, currency)} in split expenses</span>
            </span>
          </li>
        ) : null}
      </ul>
    </RecapPanel>
  );
}

function HighlightsPanel({ review }: { review: MonthReview }) {
  const run = longestRunLine(review.longestRun);
  return (
    <RecapPanel title="Highlights" className="recap-highlights">
      <ul className="recap-list">
        <li className="recap-row">
          <span className="recap-row__icon" aria-hidden="true">
            <Icon name="calendar" size={17} />
          </span>
          <span className="recap-row__text">
            <strong>{quietDaysTitle(review.daysWithoutSpending)}</strong>
            {run ? <span>{run}</span> : null}
          </span>
        </li>
      </ul>
    </RecapPanel>
  );
}

/** Card `web-recap-empty`: a month with no recorded entry (scheduled ones don't count). */
function NothingToRecap({ month }: { month: string }) {
  const addEntry = useOpenAddEntry();
  // iphone-recap-empty: below 768px the second action is a copper text button under the first.
  const tablet = useMediaQuery(TABLET);
  const titleId = useId();
  const name = monthName(month);
  return (
    <section className="card recap-empty" aria-labelledby={titleId}>
      <span className="recap-empty__icon" aria-hidden="true">
        <SparklesIcon size={32} />
      </span>
      <h2 id={titleId} className="recap-empty__title">
        Nothing to recap yet
      </h2>
      <p className="recap-empty__text">A recap needs at least one recorded entry, and {name} has none. Scheduled entries count once they're recorded.</p>
      <div className="recap-empty__actions">
        {addEntry ? (
          <Button variant="primary" icon="add" onClick={addEntry}>
            Add an entry
          </Button>
        ) : null}
        <Button variant={tablet ? "secondary" : "quiet"} onClick={chooseAnotherMonth}>
          Choose another month
        </Button>
      </div>
    </section>
  );
}

/** Takes the person to the month control: the month list where it shows (phones), else Previous month. */
function chooseAnotherMonth() {
  const select = document.querySelector<HTMLSelectElement>(".month-pill__select");
  if (select && select.getClientRects().length > 0 && getComputedStyle(select.closest(".month-pill") ?? select).display !== "none") {
    select.focus();
    try {
      select.showPicker();
    } catch {
      // Not every browser opens a select's list from script; focus is enough there.
    }
    return;
  }
  document.querySelector<HTMLButtonElement>(".month-nav__step[aria-label='Previous month']")?.focus();
}
