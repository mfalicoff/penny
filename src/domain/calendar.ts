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
