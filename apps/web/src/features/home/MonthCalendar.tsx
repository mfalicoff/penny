import type { OverviewEntry } from "@domain/selectors/overview.ts";
import { useId, useMemo, useRef, type KeyboardEvent } from "react";
import { Button, cx } from "../../design/controls";
import { formatCents } from "../../design/Money";
import { localDate } from "../households/model";
import { calendarDays, type CalendarDay } from "./model";

const WEEKDAYS = [
  ["M", "Monday"],
  ["T", "Tuesday"],
  ["W", "Wednesday"],
  ["T", "Thursday"],
  ["F", "Friday"],
  ["S", "Saturday"],
  ["S", "Sunday"],
] as const;

function longDay(date: string) {
  const [year = 2000, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

/** What a day holds, in words: the day button's accessible name. */
export function describeDay(day: CalendarDay, currency: string | undefined): string {
  const parts: string[] = [];
  if (day.expense) parts.push(`spent ${formatCents(day.expense, currency)}`);
  if (day.income) parts.push(`income ${formatCents(day.income, currency)}`);
  if (day.investment) parts.push(`invested ${formatCents(day.investment, currency)}`);
  if (day.scheduled) parts.push(`${String(day.scheduled)} scheduled`);
  return `${longDay(day.date)}${parts.length ? `: ${parts.join(", ")}` : ", nothing recorded"}`;
}

interface MonthCalendarProps {
  month: string;
  monthLabel: string;
  entries: readonly OverviewEntry[];
  selected: string | undefined;
  currency: string | undefined;
  onSelect: (day: string | undefined) => void;
}

/**
 * The month calendar (specimen `calendar`). Dots use the meaning colors only: gray spent, green
 * income, indigo invested, and an amber ring for scheduled occurrences, which are never drawn like
 * recorded entries. Selecting a day filters the list below (`?day=`), selecting it again clears it.
 * Arrow keys move by day and week, Home and End to the ends of the week.
 */
export function MonthCalendar({ month, monthLabel, entries, selected, currency, onSelect }: MonthCalendarProps) {
  const headingId = useId();
  const grid = useRef<HTMLTableElement>(null);
  const today = localDate();
  const { offset, days } = useMemo(() => calendarDays(month, entries, today), [month, entries, today]);
  const focusable = selected?.startsWith(`${month}-`) ? selected : today.startsWith(`${month}-`) ? today : days[0]?.date;
  const weeks: (CalendarDay | null)[][] = [];
  const cells: (CalendarDay | null)[] = [...Array.from({ length: offset }, () => null), ...days];
  while (cells.length % 7) cells.push(null);
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));

  const move = (event: KeyboardEvent<HTMLButtonElement>, day: CalendarDay) => {
    const weekday = (offset + day.day - 1) % 7;
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -weekday, End: 6 - weekday };
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const target = Math.min(days.length, Math.max(1, day.day + step));
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${String(target)}"]`)?.focus();
  };

  return (
    <section className="card calendar" aria-labelledby={headingId}>
      <div className="card__head">
        <h3 id={headingId} className="panel__title">
          Calendar
        </h3>
        {selected ? (
          <Button
            variant="quiet"
            icon="close"
            onClick={() => {
              onSelect(undefined);
            }}
          >
            Whole month
          </Button>
        ) : null}
      </div>
      <table className="calendar__grid" ref={grid}>
        <caption className="visually-hidden">{monthLabel}. Choose a day to list its entries.</caption>
        <thead>
          <tr>
            {WEEKDAYS.map(([short, long]) => (
              <th key={long} scope="col" abbr={long}>
                {short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, row) => (
            <tr key={row}>
              {week.map((day, column) =>
                day ? (
                  <td key={day.date}>
                    <button
                      type="button"
                      data-day={day.day}
                      tabIndex={day.date === focusable ? 0 : -1}
                      aria-pressed={day.date === selected}
                      aria-label={describeDay(day, currency)}
                      aria-current={day.date === today ? "date" : undefined}
                      className={cx("calendar__day", day.date === selected && "calendar__day--on", day.date === today && "calendar__day--today", day.date > today && "calendar__day--future")}
                      onClick={() => {
                        onSelect(day.date === selected ? undefined : day.date);
                      }}
                      onKeyDown={(event) => {
                        move(event, day);
                      }}
                    >
                      <span className="calendar__number">{day.day}</span>
                      <span className="calendar__dots" aria-hidden="true">
                        {day.expense ? <span className="calendar__dot calendar__dot--expense" /> : null}
                        {day.income ? <span className="calendar__dot calendar__dot--income" /> : null}
                        {day.investment ? <span className="calendar__dot calendar__dot--investment" /> : null}
                        {day.scheduled ? <span className="calendar__dot calendar__dot--scheduled" /> : null}
                      </span>
                    </button>
                  </td>
                ) : (
                  <td key={`empty-${String(column)}`} />
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="calendar__legend" aria-label="Legend">
        <li>
          <span className="calendar__dot calendar__dot--expense" aria-hidden="true" /> Spent
        </li>
        <li>
          <span className="calendar__dot calendar__dot--income" aria-hidden="true" /> Income
        </li>
        <li>
          <span className="calendar__dot calendar__dot--investment" aria-hidden="true" /> Invested
        </li>
        <li>
          <span className="calendar__dot calendar__dot--scheduled" aria-hidden="true" /> Scheduled
        </li>
      </ul>
    </section>
  );
}
