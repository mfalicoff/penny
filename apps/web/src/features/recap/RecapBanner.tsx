import { monthReview } from "@domain/monthReview.ts";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { setPreferences, usePreferences, type Preferences } from "../../app/preferences";
import { useToday } from "../../app/useToday";
import { Button, cx } from "../../design/controls";
import { Icon, SparklesIcon } from "../../design/Icon";
import { TABLET, useMediaQuery } from "../../app/useMediaQuery";
import { distance, duration, exitRow, motionMode, play } from "../../design/motion";
import { useOnline } from "../../design/states";
import { useActivityLedger, useSharedRows } from "../activity/data";
import { ledgerWithShared } from "../home/model";
import { useHasYear } from "../year-review/useYearReview";
import { yearBannerYear } from "../year-review/model";
import { bannerMonth, monthName } from "./model";

/**
 * "Your October recap is ready" (MAZ-292; cards `web-home-recap`, `web-insights-recap`): on Home
 * and Insights during the first 7 days of a month, for last month, when its recap has something
 * to show. See recap opens it; the close button dismisses it on this device for that month
 * (Settings' device preferences, `recapDismissed`). The web has no notification.
 *
 * In January the same banner offers last year's review ("Your 2026 in review is ready", MAZ-292
 * phase 2), with the recap banner's style and motion, until it's dismissed on this device for that
 * year (`yearReviewDismissed`). While it shows it takes the recap banner's place (owner decision,
 * the same on iOS): the two never stack. Once it's dismissed, December's recap banner shows if it's
 * still in its 7 days and not dismissed. A year with nothing recorded offers no year banner.
 */
export function RecapBanner({ className }: { className?: string }) {
  const today = useToday();
  const { recapDismissed, yearReviewDismissed } = usePreferences();
  // Kept while it plays its exit, after the dismissal is saved.
  const [leaving, setLeaving] = useState<string | null>(null);
  const year = yearBannerYear(today, yearReviewDismissed) ?? (leaving?.length === 4 ? leaving : null);
  const month = bannerMonth(today, recapDismissed) ?? (leaving?.length === 7 ? leaving : null);

  function dismiss(key: string, change: Partial<Preferences>) {
    setLeaving(key);
    setPreferences(change);
    window.setTimeout(() => {
      setLeaving(null);
    }, duration("quick") + duration("standard") + 50);
    // The close button goes with the banner: focus moves to the page.
    document.getElementById("main")?.focus();
  }

  const recap = month ? (
    <RecapReady
      key={month}
      month={month}
      className={className}
      leaving={leaving === month}
      onDismiss={() => {
        dismiss(month, { recapDismissed: month });
      }}
    />
  ) : null;
  if (!year) return recap;
  return (
    <YearReady
      key={year}
      year={year}
      className={className}
      leaving={leaving === year}
      fallback={recap}
      onDismiss={() => {
        dismiss(year, { yearReviewDismissed: year });
      }}
    />
  );
}

/** Whether last month's recap has a recorded entry, personal or shared. Null while it loads. */
function useHasRecap(month: string): boolean | null {
  const today = useToday();
  const online = useOnline();
  const { ledger } = useActivityLedger();
  const shared = useSharedRows({ type: "month", month }, online);
  const rows = shared.status === "ready" ? shared.rows : null;
  const settled = shared.status !== "loading";
  return useMemo(() => {
    if (!ledger || !settled) return null;
    return !monthReview(ledgerWithShared(ledger, rows ?? [], []), month, { today }).empty;
  }, [ledger, rows, settled, month, today]);
}

function RecapReady({ month, className, leaving, onDismiss }: { month: string; className?: string | undefined; leaving: boolean; onDismiss: () => void }) {
  const ready = useHasRecap(month);
  const name = monthName(month);
  return (
    <ReadyBanner
      ready={ready}
      className={className}
      leaving={leaving}
      onDismiss={onDismiss}
      title={`Your ${name} recap is ready`}
      message="Where your money went last month, and what changed."
      open={{ label: "See recap", to: "/insights/recap", search: { month } }}
      dismissLabel={`Dismiss the ${name} recap`}
    />
  );
}

/** January's year banner, or `fallback` (the recap banner) when the year has nothing recorded. Nothing while it's known. */
function YearReady({ year, className, leaving, fallback, onDismiss }: { year: string; className?: string | undefined; leaving: boolean; fallback: ReactNode; onDismiss: () => void }) {
  const ready = useHasYear(year);
  if (ready === false) return fallback;
  return (
    <ReadyBanner
      ready={ready}
      className={className}
      leaving={leaving}
      onDismiss={onDismiss}
      title={`Your ${year} in review is ready`}
      message="Top categories, trips, who paid and a few fun facts."
      open={{ label: "Open your year", to: "/insights/year-review", search: { year: Number(year) } }}
      dismissLabel={`Dismiss the ${year} year in review`}
    />
  );
}

type Open = { label: string; to: "/insights/recap"; search: { month: string } } | { label: string; to: "/insights/year-review"; search: { year: number } };

function OpenLink({ open, className, children }: { open: Open; className: string; children: ReactNode }) {
  return open.to === "/insights/recap" ? (
    <Link to={open.to} search={open.search} className={className}>
      {children}
    </Link>
  ) : (
    <Link to={open.to} search={open.search} className={className}>
      {children}
    </Link>
  );
}

function ReadyBanner({ ready, title, message, open, dismissLabel, className, leaving, onDismiss }: { ready: boolean | null; title: string; message: string; open: Open; dismissLabel: string; className?: string | undefined; leaving: boolean; onDismiss: () => void }) {
  // web-home-recap draws See recap as a button; below 768px, iphone-home-recap makes the row a link.
  const wide = useMediaQuery(TABLET);
  const titleId = useId();
  const element = useRef<HTMLElement | null>(null);
  // Shown with the screen when the recap is already known; arriving later, it makes room and slides in.
  const knownAtFirst = useRef(ready === true);
  const shown = ready === true;
  useLayoutEffect(() => {
    const node = element.current;
    if (!shown || knownAtFirst.current || !node) return;
    const mode = motionMode();
    if (mode === "full") {
      const height = node.getBoundingClientRect().height;
      play(node, [{ height: "0px", marginBottom: "0px", overflow: "hidden" }, { height: `${String(height)}px`, overflow: "hidden" }], { duration: "standard", mode });
      play(node, [{ opacity: 0, transform: `translateY(${String(-distance("nudge", mode))}px)` }, { opacity: 1, transform: "none" }], { duration: "standard", mode });
    } else {
      play(node, [{ opacity: 0 }, { opacity: 1 }], { duration: "quick", mode });
    }
  }, [shown]);
  useEffect(() => {
    if (leaving) exitRow(element.current);
  }, [leaving]);
  if (!shown) return null;
  return (
    <section ref={element} className={cx("card recap-banner", !wide && "recap-banner--row", className)} aria-labelledby={titleId} {...(leaving ? { inert: true } : {})}>
      <span className="recap-banner__tile" aria-hidden="true">
        <SparklesIcon size={20} />
      </span>
      <div className="recap-banner__text">
        <h2 id={titleId} className="recap-banner__title">
          {title}
        </h2>
        <p className="recap-banner__message">{message}</p>
      </div>
      {wide ? (
        <OpenLink open={open} className="wbtn wbtn--secondary recap-banner__open">
          {open.label}
        </OpenLink>
      ) : (
        // iphone-home-recap: the whole row opens the recap, with a chevron; the close button sits above it.
        <OpenLink open={open} className="recap-banner__row-link">
          <span className="visually-hidden">{open.label}</span>
          <Icon name="chevron-forward" size={16} />
        </OpenLink>
      )}
      <Button iconOnly icon="close" aria-label={dismissLabel} title="Dismiss" className="recap-banner__close" onClick={onDismiss} />
    </section>
  );
}
