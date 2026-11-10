// MAZ-86: the reusable domain module (src/domain) has no React Native/Expo/server imports, and
// its money, calendar, merge, projection and search rules agree with the shared fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { cents, emptyLedger, materialize, nextOccurrence, personalShare, type Ledger, type Recurring, type Transaction } from "../../src/domain/ledger.ts";
import { mergeLedger } from "../../src/domain/merge.ts";
import { calculateHouseholdSplits } from "../../src/domain/households.ts";
import { searchEntries } from "../../src/domain/search.ts";
import { scheduledEntries, summarizeMonth } from "../../src/domain/summary.ts";
import { calendarMonth, selectOverview, shiftMonthKey } from "../../src/domain/selectors/overview.ts";
import { selectTransactions } from "../../src/domain/selectors/transactions.ts";
import { buildMoneyFlow } from "../../src/domain/selectors/moneyFlow.ts";
import { tripOverview } from "../../src/domain/selectors/trips.ts";
import { ledgerWithHouseholds } from "../../src/features/households/projection.ts";
import type { ProjectedExpense } from "../../src/data/households.ts";

const root = new URL("../../", import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`contracts/fixtures/${name}`, root), "utf8"));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) =>
    item.isDirectory() ? sources(join(dir, item.name)) : item.name.endsWith(".ts") ? [join(dir, item.name)] : []);
}

test("src/domain imports only relative files inside src/domain", () => {
  const domain = fileURLToPath(new URL("src/domain", root));
  const files = sources(domain);
  assert.ok(files.length >= 8);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const specifier = match[1]!;
      assert.ok(specifier.startsWith("."), `${file} imports package ${specifier}`);
      const target = resolve(dirname(file), specifier);
      assert.ok(target === domain || target.startsWith(domain + sep),`${file} escapes src/domain via ${specifier}`);
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

test("projection adds every scheduled occurrence; recorded totals and expected income stay apart", () => {
  const ledger: Ledger = { ...base(), recurring: [rent, pay, invest], transactions: [{ ...base().transactions[0]!, date: "2026-10-02", share: 1000 }] };
  const before = structuredClone(ledger);
  const summary = summarizeMonth(ledger, "2026-10");
  assert.deepEqual(summary.recorded, { income: 0, expense: 1000, investment: 0 });
  assert.equal(summary.expectedIncome, 300000);
  // Rent (2026-10-31), pay and the ETF contribution are all scheduled this month.
  assert.deepEqual(summary.projected, { income: 300000, expense: 101000, investment: 50000 });
  assert.equal(summary.recordedNet, -1000);
  assert.equal(summary.projectedNet, 300000 - 101000 - 50000);
  assert.deepEqual(ledger, before);
  // Agrees with the overview selector the screens use.
  const overview = selectOverview(ledger, { month: "2026-10", day: null, filter: "all", categoryId: null, search: "" });
  assert.deepEqual(overview.summary, summary.projected);
  assert.deepEqual(overview.recorded, summary.recorded);
  assert.equal(overview.expectedIncome, summary.expectedIncome);
  // Recording the occurrences moves them from scheduled to recorded exactly once.
  const recorded = summarizeMonth(materialize(ledger, "2026-10-31"), "2026-10");
  assert.equal(recorded.expectedIncome, 0);
  assert.deepEqual(recorded.recorded, { income: 300000, expense: 101000, investment: 50000 });
  assert.deepEqual(recorded.projected, recorded.recorded);
  assert.equal(recorded.recordedNet, 300000 - 1000 - 50000 - 100000);
  assert.equal(recorded.projectedNet, summary.projectedNet);
  // Part way through the month only what is still ahead is scheduled.
  const mid = summarizeMonth(materialize(ledger, "2026-10-12"), "2026-10");
  assert.deepEqual(mid.recorded, { income: 0, expense: 1000, investment: 50000 });
  assert.deepEqual(mid.projected, summary.projected);
});

test("a personal preview is replaced only by the entry with its occurrence id", () => {
  // The rule's first entry was created on 2026-10-01 (random id) and later moved to 2026-10-08;
  // edits keep recurringId. The 2026-10-08 occurrence is still due: its id `weekly:2026-10-08`
  // is not in the ledger, so it stays scheduled (Swift `Recurrence.previews` agrees).
  const weekly: Recurring = { ...rent, id: "weekly", total: 1000, share: 1000, frequency: "weekly", anchorDay: 1, date: "2026-10-01", nextDate: "2026-10-08" };
  const first: Transaction = { id: "random-id", title: "Rent", kind: "expense", total: 1000, share: 1000, categoryId: "home", date: "2026-10-08", note: "", recurringId: "weekly" };
  const summary = summarizeMonth({ ...base(), recurring: [weekly], transactions: [first] }, "2026-10");
  assert.deepEqual(summary.recorded, { income: 0, expense: 1000, investment: 0 });
  assert.equal(summary.projected.expense, 5000);
  // Once recorded under its occurrence id, the preview is replaced.
  const recorded: Transaction = { ...first, id: "weekly:2026-10-15", date: "2026-10-15" };
  assert.equal(summarizeMonth({ ...base(), recurring: [weekly], transactions: [first, recorded] }, "2026-10").projected.expense, 5000);
});

test("a recorded shared occurrence replaces its preview in projected totals", () => {
  // Rows shaped as both servers send them (GET /api/households/projection): a preview has the id
  // `{rule}:{date}`, `scheduled` and `recurringId`; a recorded occurrence has the expense's
  // random id and, since MAZ-139, its rule as `recurringId`.
  const row = (fields: Partial<ProjectedExpense>): ProjectedExpense => ({ id: "x", householdId: "h", householdName: "Home", householdCurrency: "CAD",
    title: "Streaming", date: "2026-10-20", totalCents: 1600, shareCents: 800, payerUserId: "bea",
    category: { name: "Fun", icon: "tv-outline", color: "#B15B7D" }, note: "", ...fields });
  const preview = row({ id: "streaming:2026-10-20", scheduled: true, recurringId: "streaming" });
  const recorded = row({ id: "9d2f4c1a7b3e6f805a2c9d4e1b7f3a60", recurringId: "streaming" });
  const view = (rows: ProjectedExpense[]) => ledgerWithHouseholds(base(), rows, []);
  assert.deepEqual(summarizeMonth(view([preview]), "2026-10").recorded, { income: 0, expense: 0, investment: 0 });
  assert.equal(summarizeMonth(view([preview]), "2026-10").projected.expense, 800);
  // The runner recorded it; a cached preview of the same household rule and date is not counted again.
  const done = view([recorded, preview]);
  const summary = summarizeMonth(done, "2026-10");
  assert.deepEqual(summary.recorded, { income: 0, expense: 800, investment: 0 });
  assert.deepEqual(summary.projected, summary.recorded);
  const overview = selectOverview(done, { month: "2026-10", day: null, filter: "all", categoryId: null, search: "" });
  assert.deepEqual(overview.calendarEntries.map((entry) => entry.id).filter((id) => id.startsWith("household:")),
    [`household:h:${recorded.id}`]);
  // Another household's rule with the same id and date is a different occurrence.
  const other = row({ ...preview, householdId: "k" });
  assert.equal(summarizeMonth(view([recorded, preview, other]), "2026-10").projected.expense, 1600);
  // An older server sent recorded rows without `recurringId`: nothing links them to the preview,
  // so both count until the preview response is refreshed (the server then omits the preview).
  const { recurringId: _omitted, ...legacy } = recorded;
  assert.equal(summarizeMonth(view([legacy, preview]), "2026-10").projected.expense, 1600);
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
  const recordedRent: Transaction = { id: "rent:2026-09-30", title: "Rent", kind: "expense", total: 100000, share: 100000, categoryId: "home", date: "2026-09-30", note: "", recurringId: "rent" };
  const sharedScheduled = { id: "household:h:x", title: "Rent split", kind: "expense", total: 9000, share: 4500, categoryId: "home", date: "2026-10-28", note: "", scheduled: true } as Transaction;
  const ledger: Ledger = { ...base(), recurring: [rent], transactions: [...base().transactions, recordedRent, sharedScheduled] };
  assert.ok(scheduledEntries(ledger, "2026-10").length > 0, "October has a scheduled preview");
  const filters = { month: "2026-10", period: "month" as const, filter: "all" as const, search: "", page: 0 };
  const october = selectTransactions(ledger, filters);
  assert.equal(october.totalCount, 0, "nothing is recorded in October");
  assert.deepEqual(october.summary, { income: 0, expense: 0, investment: 0 });
  const september = selectTransactions(ledger, { ...filters, month: "2026-09" });
  assert.deepEqual(september.visibleEntries.map((entry) => entry.id), ["rent:2026-09-30", "t"]);
  assert.deepEqual(september.summary, { income: 0, expense: 101000, investment: 0 });
  assert.deepEqual(searchEntries(ledger, "rent").map((entry) => entry.id), ["rent:2026-09-30"]);
});

test("one ordering everywhere: date descending, then id ascending", () => {
  const entry = (id: string, date: string): Transaction => ({ id, title: "Same", kind: "expense", total: 100, share: 100, categoryId: "food", date, note: "", tripId: "trip" });
  const ledger: Ledger = { ...emptyLedger(), transactions: [entry("b", "2026-09-02"), entry("a", "2026-09-01"), entry("c", "2026-09-02"), entry("a2", "2026-09-02")] };
  const expected = ["a2", "b", "c", "a"];
  assert.deepEqual(searchEntries(ledger, "same").map((item) => item.id), expected);
  assert.deepEqual(selectOverview(ledger, { month: "2026-09", day: null, filter: "all", categoryId: null, search: "same" }).visibleEntries.map((item) => item.id), expected);
  assert.deepEqual(tripOverview(ledger, { id: "trip", name: "T", startDate: "2026-09-01", endDate: "2026-09-30" }).expenses.map((item) => item.id), expected);
});

test("every screen trims and lowercases the query identically", () => {
  const ledger = base();
  const overview = (search: string) => selectOverview(ledger, { month: "2026-09", day: null, filter: "all", categoryId: null, search }).visibleEntries.map((item) => item.id);
  const activity = (search: string) => selectTransactions(ledger, { month: "2026-09", period: "month", filter: "all", search, page: 0 }).visibleEntries.map((item) => item.id);
  for (const query of ["lunch ", "  LUNCH", "lunch with", "with alex", "Lunch With"]) {
    assert.deepEqual(overview(query), ["t"], query);
    assert.deepEqual(activity(query), ["t"], query);
    assert.deepEqual(searchEntries(ledger, query).map((item) => item.id), ["t"], query);
  }
  // Fields are joined by single spaces (search v1 contract), so a query cannot skip a field.
  assert.deepEqual(overview("lunch  with"), []);
});

test("search fixtures: local substring, deterministic order and pending edits/renames/deletions", () => {
  const cases = fixture("search-cases.json");
  for (const item of cases.substringCases) {
    const found = searchEntries(cases.ledger, item.query, { ...(item.kind && { kind: item.kind }), ...(item.day && { day: item.day }) });
    assert.deepEqual(found.map((entry) => entry.id), item.ids, item.query);
  }
  // Independent expectation: "coffee" hits a, b, e, all dated 2026-11-02 and tied, so id order.
  assert.deepEqual(searchEntries(cases.ledger, "coffee").map((entry) => entry.id), ["a", "b", "e"]);
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

test("redesign fixture: recorded and projected totals match summarizeMonth", () => {
  const states = fixture("redesign-states.json");
  const seeds = fixture("full-stack-seeds.json");
  const scenario = seeds.scenarios.find((item: { name: string }) => item.name === "searchable-household");
  const ledger = ([...scenario.steps].reverse().find((step: { as?: string; ledger?: Ledger }) => step.ledger && step.as === "alex") as { ledger: Ledger }).ledger;
  const month = "2026-10";
  const expected = states.totals["alex-2026-10"];
  // Every input comes from the seed; only the assertions use redesign-states.json. alex's
  // recorded shared shares and the shared rule's previews join the private ledger as the
  // Overview does (ledgerWithHouseholds): previews flagged `scheduled`.
  const members = (when: string) => when < "2026-10-02" ? ["alex", "bea", "cam"] : ["alex", "bea"];
  const alexShare = (totalCents: number, date: string) =>
    calculateHouseholdSplits(totalCents, { mode: "equal", memberIds: members(date) }).find((item) => item.userId === "alex")!.amountCents;
  const view: Ledger = structuredClone(ledger);
  for (const step of scenario.steps) {
    if (step.expense) {
      const body = step.expense.body as { title: string; date: string; totalCents: number; splitMode: string; allocations?: { userId: string; amountCents: number }[] };
      const share = body.splitMode === "equal" ? alexShare(body.totalCents, body.date)
        : body.allocations!.find((item) => item.userId === "$user:alex")?.amountCents ?? 0;
      view.transactions.push({ id: `household:maison:${step.expense.ref}`, title: body.title, kind: "expense", total: body.totalCents, share, categoryId: "shared", date: body.date, note: "" });
    }
    if (step.as === "alex" && step.sharedRecurring) {
      const rule = step.sharedRecurring;
      let date: string = rule.body.nextDate;
      const anchor = Number(date.slice(8));
      while (date <= `${month}-31`) {
        if (date.startsWith(month)) {
          view.transactions.push({ id: `household:${rule.household}:${rule.ref}:${date}`, title: rule.body.title, kind: "expense",
            total: rule.body.totalCents, share: alexShare(rule.body.totalCents, date), categoryId: "shared", date, note: "",
            recurringId: rule.ref, scheduled: true } as Transaction);
        }
        date = nextOccurrence(date, rule.body.frequency, anchor);
      }
    }
  }
  const summary = summarizeMonth(view, month);
  const totalsOf = (amounts: { expenseCents: number; incomeCents: number; investmentCents: number }) =>
    ({ income: amounts.incomeCents, expense: amounts.expenseCents, investment: amounts.investmentCents });
  assert.deepEqual(summary.recorded, totalsOf(expected.recorded));
  assert.deepEqual(summary.projected, totalsOf(expected.projected));
  assert.equal(summary.expectedIncome, 0);
  assert.equal(summary.recordedNet, -175950);
  assert.equal(summary.projectedNet, -180750);
  const overview = selectOverview(view, { month, day: null, filter: "all", categoryId: null, search: "" });
  assert.deepEqual(overview.scheduled.map((entry) => `${entry.title} ${entry.date} ${entry.share}`).sort(),
    expected.scheduled.map((item: { title: string; date: string; shareCents: number }) => `${item.title} ${item.date} ${item.shareCents}`).sort());
});
