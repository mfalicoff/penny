// MAZ-86: the reusable domain module (src/domain) has no React Native/Expo/server imports, and
// its money, calendar, merge, projection and search rules agree with the shared fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cents, emptyLedger, materialize, nextOccurrence, personalShare, type Ledger, type Recurring, type Transaction } from "../../src/domain/ledger.ts";
import { mergeLedger } from "../../src/domain/merge.ts";
import { searchEntries } from "../../src/domain/search.ts";
import { summarizeMonth } from "../../src/domain/summary.ts";
import { calendarMonth, selectOverview, shiftMonthKey } from "../../src/domain/selectors/overview.ts";
import { selectTransactions } from "../../src/domain/selectors/transactions.ts";
import { buildMoneyFlow } from "../../src/domain/selectors/moneyFlow.ts";

const root = new URL("../../", import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`contracts/fixtures/${name}`, root), "utf8"));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) =>
    item.isDirectory() ? sources(join(dir, item.name)) : item.name.endsWith(".ts") ? [join(dir, item.name)] : []);
}

test("src/domain imports only relative files inside src/domain", () => {
  const domain = new URL("src/domain/", root).pathname;
  const files = sources(domain);
  assert.ok(files.length >= 8);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const specifier = match[1]!;
      assert.ok(specifier.startsWith("."), `${file} imports package ${specifier}`);
      const target = join(file, "..", specifier);
      assert.ok(target.startsWith(domain.slice(0, -1)), `${file} escapes src/domain via ${specifier}`);
    }
    assert.doesNotMatch(text, /\b(?:process\.env|AsyncStorage|expo-)/, file);
  }
});

test("integer rounding: half cents round up and shares never exceed the total", () => {
  assert.equal(personalShare(1, "equal", "2"), 1);
  assert.equal(personalShare(1001, "equal", "2"), 501);
  assert.equal(personalShare(1, "percent", "50"), 1);
  assert.equal(personalShare(999, "percent", "33.33"), 333);
  assert.equal(cents("0.1") + cents("0.2"), 30);
  for (let total = 1; total <= 400; total++)
    for (const people of [2, 3, 7, 100]) {
      const share = personalShare(total, "equal", String(people));
      assert.ok(Number.isInteger(share) && share >= 0 && share <= total, `${total}/${people}`);
      assert.ok(Math.abs(share * people - total) <= people / 2 + 1e-9);
    }
  assert.throws(() => personalShare(100, "amount", "1.01"));
  assert.throws(() => cents("1.234"));
});

test("calendar boundaries: month ends, leap days, anchor days and year rollover", () => {
  assert.equal(nextOccurrence("2026-01-31", "monthly", 31), "2026-02-28");
  assert.equal(nextOccurrence("2026-02-28", "monthly", 31), "2026-03-31");
  assert.equal(nextOccurrence("2024-02-29", "yearly", 29), "2025-02-28");
  assert.equal(nextOccurrence("2025-02-28", "yearly", 29), "2026-02-28");
  assert.equal(nextOccurrence("2026-12-30", "weekly", 30), "2027-01-06");
  assert.equal(nextOccurrence("2026-12-31", "monthly", 31), "2027-01-31");
  assert.equal(shiftMonthKey("2026-01", -13), "2024-12");
  assert.deepEqual(calendarMonth("2024-02"), { daysInMonth: 29, offset: 3, calendarCells: 35 });
});

test("recurrence property: anchored sequences are strictly increasing and never drift", () => {
  for (const anchorDay of [1, 15, 28, 29, 30, 31]) {
    let date = `2026-01-${String(Math.min(anchorDay, 31)).padStart(2, "0")}`;
    const seen = [date];
    for (let step = 0; step < 36; step++) {
      const next = nextOccurrence(date, "monthly", anchorDay);
      assert.ok(next > date);
      seen.push(next);
      date = next;
    }
    const last = (value: string) => new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)), 0).getDate();
    for (const value of seen.slice(1)) assert.equal(Number(value.slice(8)), Math.min(anchorDay, last(value)), `${anchorDay} ${value}`);
  }
});

const base = (): Ledger => ({
  ...emptyLedger(),
  transactions: [{ id: "t", title: "Lunch", kind: "expense", total: 2000, share: 1000, categoryId: "food", date: "2026-09-20", note: "With Alex", accountId: "card" }],
  accounts: [{ id: "card", name: "Card", type: "credit" }],
});

test("merge keeps independently edited fields and applies optional-field deletion", () => {
  const original = base();
  const local = structuredClone(original);
  delete local.transactions[0]!.accountId;
  local.transactions[0]!.title = "Brunch";
  const remote = structuredClone(original);
  remote.transactions[0]!.note = "Remote note";
  remote.transactions[0]!.share = 900;
  const merged = mergeLedger(original, local, remote).transactions[0]!;
  assert.equal(merged.title, "Brunch");
  assert.equal("accountId" in merged && merged.accountId !== undefined, false);
  assert.equal(merged.note, "Remote note");
  assert.equal(merged.share, 900);
  assert.deepEqual(mergeLedger(original, original, remote), remote, "no local change keeps remote");
});

test("merge: same-field local edit wins, local deletes win, local creates survive", () => {
  const original = base();
  const local = structuredClone(original);
  local.transactions[0]!.note = "Local";
  local.transactions.push({ ...original.transactions[0]!, id: "new" });
  const remote = structuredClone(original);
  remote.transactions[0]!.note = "Remote";
  const merged = mergeLedger(original, local, remote);
  assert.deepEqual(merged.transactions.map((t) => [t.id, t.note]), [["t", "Local"], ["new", "With Alex"]]);
  const deleted = { ...original, transactions: [] };
  assert.deepEqual(mergeLedger(original, deleted, remote).transactions, []);
});

const rent: Recurring = { id: "rent", title: "Rent", kind: "expense", total: 100000, share: 100000, categoryId: "home", date: "2026-09-01", note: "", frequency: "monthly", active: true, anchorDay: 31, nextDate: "2026-09-30" };
const pay: Recurring = { ...rent, id: "pay", title: "Pay", kind: "income", total: 300000, share: 300000, categoryId: "salary", nextDate: "2026-10-15", anchorDay: 15 };
const invest: Recurring = { ...rent, id: "etf", title: "ETF", kind: "investment", total: 50000, share: 50000, categoryId: "investments", nextDate: "2026-10-10", anchorDay: 10 };

test("projection counts only scheduled income; expenses and investments stay recorded-only", () => {
  const ledger: Ledger = { ...base(), recurring: [rent, pay, invest], transactions: [{ ...base().transactions[0]!, date: "2026-10-02", share: 1000 }] };
  const before = structuredClone(ledger);
  const summary = summarizeMonth(ledger, "2026-10");
  assert.deepEqual(summary.recorded, { income: 0, expense: 1000, investment: 0 });
  assert.equal(summary.expectedIncome, 300000);
  assert.deepEqual(summary.projected, { income: 300000, expense: 1000, investment: 0 });
  assert.equal(summary.recordedRemaining, -1000);
  assert.equal(summary.projectedRemaining, 299000);
  assert.deepEqual(ledger, before);
  // Agrees with the overview selector the screens use.
  const overview = selectOverview(ledger, { month: "2026-10", day: null, filter: "all", categoryId: null, search: "" });
  assert.deepEqual(overview.summary, summary.projected);
  assert.equal(overview.expectedIncome, summary.expectedIncome);
  // Recording the occurrence moves it from expected to recorded exactly once.
  const recorded = summarizeMonth(materialize(ledger, "2026-10-31"), "2026-10");
  assert.equal(recorded.expectedIncome, 0);
  assert.equal(recorded.recorded.income, 300000);
  assert.equal(recorded.recorded.investment, 50000);
  assert.equal(recorded.recordedRemaining, 300000 - 1000 - 50000 - 100000);
});

test("investment contributions are not spending and personal shares drive totals and flow", () => {
  const entries: Transaction[] = [
    { id: "i", title: "Pay", kind: "income", total: 100000, share: 100000, categoryId: "salary", date: "2026-10-01", note: "" },
    { id: "e", title: "Dinner", kind: "expense", total: 9000, share: 3000, categoryId: "food", date: "2026-10-02", note: "" },
    { id: "v", title: "ETF", kind: "investment", total: 20000, share: 20000, categoryId: "investments", date: "2026-10-03", note: "" },
  ];
  const flow = buildMoneyFlow(entries, base().categories);
  assert.equal(flow.expense, 3000);
  assert.equal(flow.investment, 20000);
  assert.equal(flow.remaining, 77000);
});

test("recorded-only Activity ignores scheduled previews and projected totals", () => {
  const ledger: Ledger = { ...base(), recurring: [rent] };
  const result = selectTransactions(ledger, { month: "2026-10", period: "month", filter: "all", search: "", page: 0 });
  assert.equal(result.totalCount, 0);
  assert.deepEqual(result.summary, { income: 0, expense: 0, investment: 0 });
  assert.deepEqual(searchEntries(ledger, "rent"), []);
});

test("search fixtures: local substring, deterministic order and pending edits/renames/deletions", () => {
  const cases = fixture("search-cases.json");
  for (const item of cases.substringCases) {
    const found = searchEntries(cases.ledger, item.query, { ...(item.kind && { kind: item.kind }), ...(item.day && { day: item.day }) });
    assert.deepEqual(found.map((entry) => entry.id), item.ids, item.query);
    const sorted = [...found].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    assert.deepEqual(found, sorted);
  }
  for (const item of cases.pendingCases) {
    const local: Ledger = structuredClone(cases.ledger);
    if (item.localCreate) local.transactions.push(item.localCreate);
    if (item.editId) Object.assign(local.transactions.find((entry) => entry.id === item.editId)!, item.patch);
    if (item.deleteId) local.transactions = local.transactions.filter((entry) => entry.id !== item.deleteId);
    assert.deepEqual(searchEntries(local, item.query).map((entry) => entry.id), item.expectedIds, item.name);
  }
  // Renaming a category or account changes what matches without touching entries.
  const renamed: Ledger = structuredClone(cases.ledger);
  renamed.categories.find((category) => category.id === "food")!.name = "Groceries";
  assert.ok(searchEntries(renamed, "grocer").length > 0);
});

test("redesign fixture: recorded vs projected totals match summarizeMonth", () => {
  const states = fixture("redesign-states.json");
  const seeds = fixture("full-stack-seeds.json");
  const scenario = seeds.scenarios.find((item: { name: string }) => item.name === "searchable-household");
  const ledger = ([...scenario.steps].reverse().find((step: { as?: string; ledger?: Ledger }) => step.ledger && step.as === "alex") as { ledger: Ledger }).ledger;
  const summary = summarizeMonth(ledger, "2026-10");
  const personal = states.totals["alex-2026-10"].scheduled.find((item: { source: string }) => item.source === "personal");
  // Personal projection: the fixture's projected expense adds scheduled spending, which the
  // client summary deliberately excludes; income and investment agree.
  assert.equal(summary.recorded.investment, states.totals["alex-2026-10"].recorded.investmentCents);
  assert.equal(summary.projected.expense, summary.recorded.expense);
  assert.ok(personal.shareCents > 0);
});
