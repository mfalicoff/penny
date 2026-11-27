import { yearReviewYear } from "@domain/yearReview.ts";
import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { TABLET, useMediaQuery } from "../../app/useMediaQuery";
import { useToday } from "../../app/useToday";
import { cx } from "../../design/controls";
import { Icon } from "../../design/Icon";

/**
 * The year in review's entry in Insights (MAZ-292 phase 2; cards `web-insights-year-review`,
 * `iphone-insights-year-review`): "2026 in review · Your year in Penny", above the month's
 * summary, for the whole window it's offered in (December 26 to January 31, `yearReviewYear`).
 * Open your year opens it; below 768px the whole card is the link, with a round copper chevron.
 */
export function YearReviewCard() {
  const today = useToday();
  const year = yearReviewYear(today);
  const wide = useMediaQuery(TABLET);
  const titleId = useId();
  if (!year) return null;
  return (
    <section className={cx("card year-card", !wide && "year-card--row")} aria-labelledby={titleId}>
      <span className="year-card__glow" aria-hidden="true" />
      <div className="year-card__text">
        <p className="year-card__eyebrow">{year} in review</p>
        <h2 id={titleId} className="year-card__title">
          Your year in Penny
        </h2>
        <p className="year-card__message">Top categories, trips, who paid and a few fun facts. Here until January 31.</p>
      </div>
      <Link to="/insights/year-review" search={{ year: Number(year) }} className={wide ? "wbtn wbtn--primary year-card__open" : "year-card__go"}>
        {wide ? (
          "Open your year"
        ) : (
          <>
            <span className="visually-hidden">Open your year</span>
            <Icon name="chevron-forward" size={18} weight={52} />
          </>
        )}
      </Link>
    </section>
  );
}
