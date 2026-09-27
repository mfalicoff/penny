import { expect, test } from "@jest/globals";
import { click, renderWeb } from "../../../../tests/web-renderer";
import { emptyLedger } from "../../../domain/ledger";
import { MoneyFlowChart } from "../components/MoneyFlowChart";

const categories = emptyLedger().categories;
const expense = { id: "metro", title: "metro", kind: "expense", categoryId: "groceries", total: 9800, share: 4900, date: "2026-09-27", note: "" };
const income = { ...expense, id: "pay", title: "Pay", kind: "income", categoryId: "salary", total: 10000, share: 10000 };

test.each([
  ["empty", []],
  ["expense only with a split", [expense]],
  ["income only", [income]],
  ["income and expenses", [income, expense]],
  ["overspending", [{ ...income, share: 1000 }, expense]],
  ["break even", [{ ...income, share: 4900 }, expense]],
])("renders %s with the real SVG web implementation", async (_name, entries) => {
  const body = await renderWeb(<MoneyFlowChart entries={entries} categories={categories} currency="CAD" monthLabel="September 2026" />);
  expect(body.textContent).toContain("Follow your money");
  if (!entries.length) {
    expect(body.querySelector("svg")).toBeNull();
    return;
  }
  expect(body.querySelector("svg")).not.toBeNull();
  expect(body.querySelector("svg").hasAttribute("accessible")).toBe(false);
  expect(body.querySelector("svg").getAttribute("aria-hidden")).toBe("true");
  expect(body.querySelector("svg").getAttribute("tabindex")).toBe("-1");
});

test("chart labels highlight and clear a flow while retaining accessible text", async () => {
  const body = await renderWeb(<MoneyFlowChart entries={[expense]} categories={categories} currency="CAD" monthLabel="September 2026" />);
  const groceries = body.querySelector('[aria-label^="Groceries,"]');
  expect(groceries).not.toBeNull();
  expect(body.textContent).toContain("Beyond income");
  await click(groceries);
  expect(body.textContent).toContain("Groceries · $49.00 · 100.0% of monthly flow");
  await click(groceries);
  expect(body.textContent).toContain("Tap a label to highlight its flow");
});
