import type { OverviewEntry } from "@domain/selectors/overview.ts";
import { useToday } from "../../app/useToday";
import { cx } from "../../design/controls";
import { formatCents } from "../../design/Money";
import { Panel } from "./parts";

/** "Oct 1". */
function shortMonthDay(month: string, day: number) {
  const [year = 2000, number = 1] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1, day)).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Card `ipad-home` "Daily spending" (MAZ-223): the month's recorded spending (your share) per day,
 * with the daily average over the whole month. Days well above the average are full copper, the
 * other days pale copper, and days still to come a short gray stub. The bars are decoration; a
 * list for screen readers carries every day with spending.
 */
export function DailySpending({ month, entries, currency }: { month: string; entries: readonly OverviewEntry[]; currency: string | undefined }) {
  const today = useToday();
  const [year = 2000, number = 1] = month.split("-").map(Number);
  const length = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const days = Array.from({ length }, () => 0);
  for (const entry of entries) {
    if (entry.kind !== "expense" || entry.scheduled || !entry.date.startsWith(`${month}-`)) continue;
    const index = Number(entry.date.slice(8, 10)) - 1;
    days[index] = (days[index] ?? 0) + entry.share;
  }
  const total = days.reduce((sum, value) => sum + value, 0);
  const average = Math.round(total / length);
  const highest = Math.max(1, ...days);
  const future = (day: number) => `${month}-${String(day).padStart(2, "0")}` > today;
  const spent = days.map((amount, index) => ({ day: index + 1, amount })).filter((item) => item.amount > 0);
  return (
    <Panel title="Daily spending" className="daily" action={<span className="muted">Avg {formatCents(average, currency)}</span>}>
      <div className="daily__chart" aria-hidden="true">
        {days.map((amount, index) => {
          const day = index + 1;
          const later = future(day) && !amount;
          return <i key={day} className={cx("daily__bar", later ? "daily__bar--future" : amount > average * 2 && "daily__bar--high")} style={later ? undefined : { height: `${String(Math.max(1.5, (amount / highest) * 100))}%` }} />;
        })}
      </div>
      <p className="daily__axis" aria-hidden="true">
        <span>{shortMonthDay(month, 1)}</span>
        <span>15</span>
        <span>{length}</span>
      </p>
      <ul className="visually-hidden">
        {spent.length ? (
          spent.map((item) => (
            <li key={item.day}>
              {shortMonthDay(month, item.day)}: {formatCents(item.amount, currency)}
            </li>
          ))
        ) : (
          <li>No spending recorded this month.</li>
        )}
      </ul>
    </Panel>
  );
}
