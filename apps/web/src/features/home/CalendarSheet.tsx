import type { Ledger, Transaction } from "@domain/ledger.ts";
import { useId } from "react";
import { Icon } from "../../design/Icon";
import { formatCents } from "../../design/Money";
import { ModalDialog } from "../../design/ModalDialog";
import { monthLabel, shiftMonth } from "../households/model";
import type { MonthReport } from "./model";
import { MonthCalendar } from "./MonthCalendar";
import { EntryRows } from "./parts";

/** "Friday, Nov 6". */
function dayTitle(date: string) {
  const [year = 2000, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-CA", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
}

interface CalendarSheetProps {
  month: string;
  report: MonthReport;
  view: Ledger;
  currency: string;
  /** The selected day (`?day=`), if it is in the month. */
  selected: string | undefined;
  onSelect: (day: string | undefined) => void;
  /** Another month; `undefined` is the current one. */
  onMonth: (month: string | undefined) => void;
  /** The current month with today selected. */
  onToday: () => void;
  onOpen: (entry: Transaction, opener: HTMLElement) => void;
  onClose: () => void;
}

/**
 * The calendar sheet over Home (card `iphone-calendar`, MAZ-224), opened from Home's calendar
 * button: Close, the month with Previous and Next, Today, the month grid, and the selected day's
 * entries with the day's net under it. Recorded entries count toward the net; scheduled ones are
 * listed, labelled, and don't.
 */
export function CalendarSheet({ month, report, view, currency, selected, onSelect, onMonth, onToday, onOpen, onClose }: CalendarSheetProps) {
  const titleId = useId();
  const dayId = useId();
  const label = monthLabel(month);
  const day = selected?.startsWith(`${month}-`) ? selected : undefined;
  const entries = day ? report.calendarEntries.filter((entry) => entry.date === day) : [];
  const net = entries.reduce((sum, entry) => (entry.scheduled ? sum : sum + (entry.kind === "income" ? entry.share : -entry.share)), 0);
  return (
    <ModalDialog labelledBy={titleId} onClose={onClose} panelClassName="calendar-sheet">
      <div className="calendar-sheet__grabber" aria-hidden="true" />
      <div className="calendar-sheet__bar">
        <button type="button" className="calendar-sheet__close" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
        <div className="calendar-sheet__month">
          <button
            type="button"
            className="calendar-sheet__step"
            aria-label="Previous month"
            onClick={() => {
              onMonth(shiftMonth(month, -1));
            }}
          >
            <Icon name="chevron-back" size={18} />
          </button>
          <h2 id={titleId} aria-live="polite">
            {label}
          </h2>
          <button
            type="button"
            className="calendar-sheet__step"
            aria-label="Next month"
            onClick={() => {
              onMonth(shiftMonth(month, 1));
            }}
          >
            <Icon name="chevron-forward" size={18} />
          </button>
        </div>
        <button type="button" className="glass calendar-sheet__today" onClick={onToday}>
          Today
        </button>
      </div>
      <MonthCalendar month={month} monthLabel={label} entries={report.calendarEntries} selected={day} currency={currency} onSelect={onSelect} />
      {day ? (
        <section className="calendar-sheet__day" aria-labelledby={dayId}>
          <h3 id={dayId} className="calendar-sheet__day-head">
            <span>{dayTitle(day)}</span>
            {net ? <span className="pk-num">{formatCents(net, currency, { signed: true })}</span> : null}
          </h3>
          {entries.length ? <EntryRows day entries={entries} ledger={view} currency={currency} onOpen={onOpen} /> : <p className="muted calendar-sheet__none">Nothing on this day.</p>}
        </section>
      ) : (
        <p className="muted calendar-sheet__none">Choose a day to see its entries.</p>
      )}
    </ModalDialog>
  );
}
