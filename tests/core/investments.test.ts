import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyLedger, materialize, totals, upgradeLedger, type Ledger } from "../../src/domain/ledger.ts";
import { buildEntry, type EntryDraft } from "../../src/features/entries/entryDraft.ts";
import { saveEntry } from "../../src/domain/commands.ts";
import { selectOverview } from "../../src/features/overview/selectors.ts";
import { buildMoneyFlow, layoutMoneyFlow } from "../../src/features/overview/moneyFlow.ts";
import { ledgerWriteSchema } from "../../server/validation/ledger.ts";
import { openDatabase } from "../../server/infrastructure/database.ts";
import { createRepositories } from "../../server/infrastructure/repositories.ts";
import { createLedgerService } from "../../server/application/ledger.ts";

const draft: EntryDraft = {
  kind: "investment", title: "TFSA contribution", amount: "1000.00",
  date: "2026-01-31", categoryId: "investments", note: "", split: "equal",
  shareInput: "2", frequency: "monthly",
  receipt: { id: "old-receipt", name: "Receipt", mime: "image/png", uri: "old-receipt" },
};

test("investment contributions use the full amount and recur once without receipts", () => {
  const ledger = emptyLedger();
  const { transaction, recurring } = buildEntry(draft, ledger.categories);
  assert.equal(transaction.share, 100000);
  assert.equal(transaction.receipt, undefined);
  assert.equal(recurring?.kind, "investment");
  const saved = saveEntry(transaction, undefined, recurring)(ledger);
  const due = materialize(saved, "2026-03-31");
  assert.deepEqual(due.transactions.map((t) => t.date), ["2026-01-31", "2026-02-28", "2026-03-31"]);
  assert.deepEqual(totals(due.transactions), { income: 0, expense: 0, investment: 300000 });
  assert.deepEqual(materialize(due, "2026-03-31"), due);
});

test("overview and flow separate contributions from spending, including cash deficits", () => {
  const ledger = emptyLedger();
  const { transaction } = buildEntry({ ...draft, frequency: "none" }, ledger.categories);
  ledger.transactions = [transaction,
    { ...transaction, id: "salary", kind: "income", categoryId: "salary", total: 500000, share: 500000 },
    { ...transaction, id: "rent", kind: "expense", categoryId: "home", total: 300000, share: 300000 },
  ];
  const overview = selectOverview(ledger, { month: "2026-01", day: null, filter: "investment", search: "TFSA" });
  assert.deepEqual(overview.summary, { income: 500000, expense: 300000, investment: 100000 });
  assert.deepEqual(overview.visibleEntries, [transaction]);
  assert.deepEqual(overview.spending.map((c) => [c.id, c.amount]), [["home", 300000]]);
  for (const income of [500000, 400000, 200000, 0]) {
    ledger.transactions[1].share = ledger.transactions[1].total = income;
    const flow = buildMoneyFlow(ledger.transactions, ledger.categories);
    assert.equal(flow.expense, 300000);
    assert.equal(flow.investment, 100000);
    assert.equal(flow.remaining, Math.max(0, income - 400000));
    assert.equal(flow.gap, Math.max(0, 400000 - income));
    assert.equal(flow.sources.reduce((s, n) => s + n.amount, 0), flow.destinations.reduce((s, n) => s + n.amount, 0));
    assert.equal(flow.destinations.find((n) => n.id === "investment:total")?.amount, 100000);
    const layout = layoutMoneyFlow(flow);
    for (const node of [...layout.sources, ...layout.destinations]) assert.ok(Number.isFinite(node.y + node.height));
  }
  const onlyInvestment = buildMoneyFlow([transaction], ledger.categories);
  assert.equal(onlyInvestment.expense, 0);
  assert.equal(onlyInvestment.gap, 100000);
});

test("investment validation rejects splits and mismatched categories for entries and schedules", () => {
  const ledger = emptyLedger();
  const { transaction, recurring } = buildEntry(draft, ledger.categories);
  const saved = saveEntry(transaction, undefined, recurring)(ledger);
  assert.equal(ledgerWriteSchema.safeParse({ revision: 0, ledger: saved }).success, true);
  for (const collection of ["transactions", "recurring"] as const) {
    for (const invalid of [{ share: 50000 }, { categoryId: "food" }, { kind: "unknown" }, { total: -1 }]) {
      const changed = { ...saved, [collection]: [{ ...saved[collection][0], ...invalid }] };
      assert.equal(ledgerWriteSchema.safeParse({ revision: 0, ledger: changed }).success, false);
    }
  }
});

test("legacy upgrade preserves history, avoids category ID collisions, and runs only once", () => {
  const ledger = emptyLedger();
  const { transaction } = buildEntry({ ...draft, kind: "expense", categoryId: "food" }, ledger.categories);
  const legacy = { ...ledger, version: 1 as const, transactions: [transaction],
    categories: ledger.categories.filter((c) => c.kind !== "investment") };
  legacy.categories.push({ id: "investments", name: "Old investing expenses", kind: "expense", icon: "pricetag-outline", color: "#678DB1" });
  const updated = upgradeLedger(legacy);
  assert.equal(updated.version, 4);
  assert.deepEqual(updated.transactions, legacy.transactions);
  assert.equal(updated.categories.find((c) => c.kind === "investment")?.id, "investments-1");
  assert.equal(upgradeLedger(updated), updated);
  const deleted = { ...updated, categories: updated.categories.filter((c) => c.kind !== "investment") };
  assert.equal(upgradeLedger(deleted), deleted);
  assert.equal(ledgerWriteSchema.parse({ revision: 0, ledger: legacy }).ledger.version, 4);
});

test("legacy accounts can read, save, and reload investments with revision protection", (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const repositories = createRepositories(db);
  const ledger = emptyLedger();
  repositories.accounts.create({ id: "investor", email: "investor@example.test", password: "hash", salt: "salt" }, ledger);
  const legacy = { ...ledger, version: 1, categories: ledger.categories.filter((c) => c.kind !== "investment") };
  db.prepare("UPDATE ledgers SET data = ? WHERE user_id = ?").run(JSON.stringify(legacy), "investor");
  const service = createLedgerService(repositories.ledgers, repositories.receipts);
  const snapshot = service.read("investor");
  assert.equal(snapshot.ledger.version, 4);
  const { transaction, recurring } = buildEntry(draft, snapshot.ledger.categories);
  const saved = service.save("investor", { ...snapshot, ledger: saveEntry(transaction, undefined, recurring)(snapshot.ledger) });
  assert.deepEqual(service.read("investor"), JSON.parse(JSON.stringify(saved)));
  assert.equal(saved.revision, 1);
  assert.throws(() => service.save("investor", snapshot), { reason: "conflict" });
  const reloaded: Ledger = JSON.parse(db.prepare("SELECT data FROM ledgers WHERE user_id = ?").get("investor")!.data as string);
  assert.equal(reloaded.version, 4);
  assert.equal(reloaded.transactions[0].kind, "investment");
});
