import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMoneyFlow, layoutMoneyFlow } from "../src/features/overview/moneyFlow.ts";
import { emptyLedger, type Transaction } from "../src/domain/ledger.ts";
const categories = emptyLedger().categories;
const entry = (
  kind: Transaction["kind"],
  share: number,
  categoryId: string,
  total = share,
): Transaction => ({
  id: `${categoryId}-${share}`,
  title: "Test entry",
  kind,
  share,
  total,
  categoryId,
  date: "2026-09-27",
  note: "",
});
const sum = (nodes: { amount: number }[]) =>
  nodes.reduce((total, node) => total + node.amount, 0);

test("money flow uses personal shares and conserves income including left over", () => {
  const result = buildMoneyFlow(
    [
      entry("income", 500000, "salary"),
      entry("expense", 6000, "food", 12000),
      entry("expense", 4000, "food"),
      entry("expense", 150000, "home"),
    ],
    categories,
  );
  assert.equal(result.income, 500000);
  assert.equal(result.expense, 160000);
  assert.equal(
    result.destinations.find((n) => n.id === "expense:food")?.amount,
    10000,
  );
  assert.equal(result.remaining, 340000);
  assert.equal(sum(result.sources), sum(result.destinations));
});
test("expense-only and overspending months balance with an explicit gap", () => {
  for (const income of [0, 5000]) {
    const result = buildMoneyFlow(
      [entry("income", income, "salary"), entry("expense", 8000, "food")],
      categories,
    );
    assert.equal(result.gap, 8000 - income);
    assert.equal(result.income, income, "gap is not counted as income");
    assert.equal(result.sources.at(-1)?.id, "balance:gap");
    assert.equal(result.remaining, 0);
    assert.equal(sum(result.sources), sum(result.destinations));
  }
});
test("empty, income-only, and break-even months have no zero-width balancing nodes", () => {
  assert.deepEqual(buildMoneyFlow([], categories).sources, []);
  assert.equal(
    buildMoneyFlow([entry("expense", 0, "food", 10000)], categories).total,
    0,
  );
  const income = buildMoneyFlow([entry("income", 5000, "salary")], categories);
  assert.equal(income.destinations[0].id, "balance:remaining");
  const even = buildMoneyFlow(
    [entry("income", 5000, "salary"), entry("expense", 5000, "food")],
    categories,
  );
  assert.equal(even.gap, 0);
  assert.equal(even.remaining, 0);
  assert.equal(even.sources.length, 1);
  assert.equal(even.destinations.length, 1);
});
test("many small categories are grouped without losing money, and layout remains proportional", () => {
  const expenses = Array.from({ length: 12 }, (_, i) =>
    entry("expense", i + 1, `category-${i}`),
  );
  const flow = buildMoneyFlow(
    [entry("income", 100000, "salary"), ...expenses],
    categories,
  );
  assert.equal(flow.destinations.length, 7);
  assert.equal(flow.expense, 78);
  assert.equal(
    flow.destinations.find((n) => n.id === "expense:overflow")?.amount,
    28,
  );
  assert.equal(sum(flow.sources), sum(flow.destinations));
  const layout = layoutMoneyFlow(flow);
  for (const column of [layout.sources, layout.destinations]) {
    assert.ok(
      Math.abs(
        column.reduce((total, node) => total + node.height, 0) -
          layout.bandHeight,
      ) < 1e-8,
    );
    column.forEach((node, i) => {
      assert.ok(node.y >= 0 && node.y + node.height <= layout.height);
      assert.ok(
        Math.abs(node.height / layout.bandHeight - node.amount / flow.total) <
          1e-8,
      );
      if (i)
        assert.ok(
          node.y +
            node.height / 2 -
            (column[i - 1].y + column[i - 1].height / 2) >=
            48,
          "labels do not overlap",
        );
    });
  }
});
