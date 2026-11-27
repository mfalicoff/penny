import { monthReview } from "@domain/monthReview.ts";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { setPreferences, usePreferences } from "../../app/preferences";
import { useToday } from "../../app/useToday";
import { Button, cx } from "../../design/controls";
import { Icon, SparklesIcon } from "../../design/Icon";
import { TABLET, useMediaQuery } from "../../app/useMediaQuery";
import { distance, duration, exitRow, motionMode, play } from "../../design/motion";
import { useOnline } from "../../design/states";
import { useActivityLedger, useSharedRows } from "../activity/data";
import { ledgerWithShared } from "../home/model";
import { bannerMonth, monthName } from "./model";

/**
 * "Your October recap is ready" (MAZ-292; cards `web-home-recap`, `web-insights-recap`): on Home
 * and Insights during the first 7 days of a month, for last month, when its recap has something
 * to show. See recap opens it; the close button dismisses it on this device for that month
 * (Settings' device preferences, `recapDismissed`). The web has no notification.
 */
export function RecapBanner({ className }: { className?: string }) {
  const today = useToday();
  const { recapDismissed } = usePreferences();
  // Kept while it plays its exit, after the dismissal is saved.
  const [leaving, setLeaving] = useState<string | null>(null);
  const month = bannerMonth(today, recapDismissed) ?? leaving;
  if (!month) return null;
  return (
    <ReadyBanner
      key={month}
      month={month}
      className={className}
      leaving={leaving === month}
      onDismiss={() => {
        setLeaving(month);
        setPreferences({ recapDismissed: month });
        window.setTimeout(() => {
          setLeaving(null);
        }, duration("quick") + duration("standard") + 50);
        // The close button goes with the banner: focus moves to the page.
        document.getElementById("main")?.focus();
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

function ReadyBanner({ month, className, leaving, onDismiss }: { month: string; className?: string | undefined; leaving: boolean; onDismiss: () => void }) {
  const ready = useHasRecap(month);
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
  const name = monthName(month);
  return (
    <section ref={element} className={cx("card recap-banner", !wide && "recap-banner--row", className)} aria-labelledby={titleId} {...(leaving ? { inert: true } : {})}>
      <span className="recap-banner__tile" aria-hidden="true">
        <SparklesIcon size={20} />
      </span>
      <div className="recap-banner__text">
        <h2 id={titleId} className="recap-banner__title">
          Your {name} recap is ready
        </h2>
        <p className="recap-banner__message">Where your money went last month, and what changed.</p>
      </div>
      {wide ? (
        <Link to="/insights/recap" search={{ month }} className="wbtn wbtn--secondary recap-banner__open">
          See recap
        </Link>
      ) : (
        // iphone-home-recap: the whole row opens the recap, with a chevron; the close button sits above it.
        <Link to="/insights/recap" search={{ month }} className="recap-banner__row-link">
          <span className="visually-hidden">See recap</span>
          <Icon name="chevron-forward" size={16} />
        </Link>
      )}
      <Button iconOnly icon="close" aria-label={`Dismiss the ${name} recap`} title="Dismiss" className="recap-banner__close" onClick={onDismiss} />
    </section>
  );
}
