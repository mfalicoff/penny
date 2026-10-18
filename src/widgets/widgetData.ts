import { dateKey, totals, type Ledger } from "../domain/ledger";
import { currencyFormat } from "../shared/format";

export type ChartSegment = { x: number; y: number; width: number; angle: number };
export type ChartWidgetProps = {
  month: string;
  balance: string;
  income: ChartSegment[];
  expenses: ChartSegment[];
  hasEntries: boolean;
};
export type RecentWidgetProps = {
  expenses: { id: string; title: string; amount: string }[];
};

const CHART_WIDTH = 112;
const CHART_HEIGHT = 44;

function lineSegments(values: number[], maximum: number, daysInMonth: number): ChartSegment[] {
  const points = values.map((value, day) => ({
    x: day * CHART_WIDTH / Math.max(1, daysInMonth - 1),
    y: CHART_HEIGHT - 2 - value / maximum * (CHART_HEIGHT - 4),
  }));
  if (points.length === 1) points.push({ ...points[0], x: 5 });
  return points.slice(1).map((point, index) => {
    const previous = points[index];
    const dx = point.x - previous.x;
    const dy = point.y - previous.y;
    return {
      x: (previous.x + point.x) / 2 - CHART_WIDTH / 2,
      y: (previous.y + point.y) / 2 - CHART_HEIGHT / 2,
      width: Math.hypot(dx, dy),
      angle: Math.atan2(dy, dx) * 180 / Math.PI,
    };
  });
}

export function widgetData(ledger: Ledger, today = new Date()): {
  chart: ChartWidgetProps;
  recent: RecentWidgetProps;
} {
  const currentMonth = dateKey(today).slice(0, 7);
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const todayDay = today.getDate();
  const todayKey = dateKey(today);
  const recorded = ledger.transactions.filter((entry) => entry.date <= todayKey);
  const monthEntries = recorded.filter((entry) => entry.date.startsWith(currentMonth));
  const summary = totals(monthEntries);
  const incomeByDay = Array(daysInMonth).fill(0) as number[];
  const expenseByDay = Array(daysInMonth).fill(0) as number[];
  for (const entry of monthEntries) {
    const day = Number(entry.date.slice(8, 10)) - 1;
    if (entry.kind === "income") incomeByDay[day] += entry.share;
    if (entry.kind === "expense") expenseByDay[day] += entry.share;
  }
  const cumulative = (daily: number[]) => {
    let amount = 0;
    return daily.slice(0, todayDay).map((value) => (amount += value));
  };
  const income = cumulative(incomeByDay);
  const expenses = cumulative(expenseByDay);
  const maximum = Math.max(1, income.at(-1) ?? 0, expenses.at(-1) ?? 0);
  return {
    chart: {
      month: today.toLocaleDateString("en-CA", { month: "short" }).toUpperCase(),
      balance: currencyFormat(summary.income - summary.expense - summary.investment, ledger.currency),
      income: lineSegments(income, maximum, daysInMonth),
      expenses: lineSegments(expenses, maximum, daysInMonth),
      hasEntries: monthEntries.some((entry) => entry.kind === "income" || entry.kind === "expense"),
    },
    recent: {
      expenses: recorded.filter((entry) => entry.kind === "expense")
        .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
        .slice(0, 3)
        .map((entry) => ({ id: entry.id, title: entry.title, amount: currencyFormat(entry.share, ledger.currency) })),
    },
  };
}
