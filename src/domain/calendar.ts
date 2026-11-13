import { dateKey, parseDate } from "./ledger.ts";

export function calendarMonth(month: string) {
  const date = parseDate(`${month}-01`);
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const offset = (date.getDay() + 6) % 7;
  return { daysInMonth, offset, calendarCells: Math.ceil((daysInMonth + offset) / 7) * 7 };
}

export function shiftMonthKey(month: string, delta: number) {
  const date = parseDate(`${month}-01`);
  return dateKey(new Date(date.getFullYear(), date.getMonth() + delta, 1)).slice(0, 7);
}

/**
 * The calendar date an instant falls on in an IANA time zone (`YYYY-MM-DD`): "today" for a
 * person whose zone is known, such as a test clock or a fixture (MAZ-136). On a device,
 * `dateKey()` already gives the local date. Always Gregorian with Latin digits.
 */
export function dateKeyIn(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, calendar: "gregory", numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(instant);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
