import { emptyLedger, type Transaction } from "../../../src/domain/ledger";
import { widgetData } from "../../../src/widgets/widgetData";

const entry = (id: string, kind: Transaction["kind"], date: string, share: number): Transaction => ({
  id, kind, date, share, total: share, title: id, categoryId: kind === "income" ? "salary" : "food", note: "",
});

test("widget snapshots show current-month net and recorded expense history", () => {
  const ledger = emptyLedger();
  ledger.transactions = [
    entry("older", "expense", "2026-09-30", 900),
    entry("salary", "income", "2026-10-02", 10000),
    entry("coffee", "expense", "2026-10-03", 1500),
    entry("invested", "investment", "2026-10-05", 2000),
    entry("groceries", "expense", "2026-10-07", 2500),
    entry("future", "expense", "2026-10-19", 700),
  ];

  const { chart, recent } = widgetData(ledger, new Date(2026, 9, 18));
  expect(chart.balance).toBe("$40.00");
  expect(chart.hasEntries).toBe(true);
  expect(chart.income).toHaveLength(17);
  expect(chart.expenses).toHaveLength(17);
  expect(recent.expenses.map((item) => item.id)).toEqual(["groceries", "coffee", "older"]);
});
