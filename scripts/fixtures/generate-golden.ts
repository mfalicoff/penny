// Generates the language-neutral golden fixtures from the legacy TypeScript rules (the
// observable contract) and the fixture manifest (MAZ-62). Inputs are curated here;
// expectations are computed, so the files never drift from the reference behavior.
//
//   node --experimental-strip-types scripts/fixtures/generate-golden.ts          # write
//   node --experimental-strip-types scripts/fixtures/generate-golden.ts --check  # verify
//
// Output is byte-for-byte deterministic: no clock, randomness or locale is read, and the
// date rules run at local noon, so any TZ produces the same files (tests check this).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { cents, nextOccurrence, personalShare, type Frequency, type Ledger } from "../../src/domain/ledger.ts";
import { mergeLedger } from "../../src/domain/merge.ts";
import { ledgerWriteSchema } from "../../server/validation/ledger.ts";

const directory = new URL("../../contracts/fixtures/", import.meta.url);
const generator = "scripts/fixtures/generate-golden.ts";

type Outcome<T> = { value: T } | { error: string };
function attempt<T>(run: () => T): Outcome<T> {
  try {
    return { value: run() };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

function money() {
  const inputs = [
    "0", "0.01", "0.1", "1", "1.5", "1,50", " 12.30 ", "12.", "007.25", "999999999.99", "999999999",
    "1000000000", "1.234", "-1", "", "  ", "abc", ".5", "1e3", "1 000", "+3", "١٢",
  ];
  const parse = inputs.map((input) => {
    const result = attempt(() => cents(input));
    return "value" in result ? { input, cents: result.value } : { input, error: result.error };
  });
  const shareInputs: [number, "full" | "equal" | "amount" | "percent", string][] = [
    [1001, "full", ""], [1001, "equal", "2"], [1001, "equal", "3"], [1, "equal", "2"], [1001, "equal", "1"],
    [1001, "equal", "101"], [1001, "equal", "2.5"], [1001, "percent", "33.33"], [1001, "percent", "50"],
    [1001, "percent", "100"], [1001, "percent", "100.01"], [1001, "percent", "0"], [1001, "amount", "10.01"],
    [1001, "amount", "10.02"], [1001, "amount", "0"], [99999999999, "equal", "3"], [99999999999, "percent", "33.33"],
  ];
  const personalShares = shareInputs.map(([total, mode, input]) => {
    const result = attempt(() => personalShare(total, mode, input));
    return "value" in result ? { total, mode, input, share: result.value } : { total, mode, input, error: result.error };
  });
  // Integer-cent bounds of a stored entry, as the ledger write schema enforces them.
  const entry = (total: unknown, share: unknown) => ({
    version: 4, currency: "CAD", accounts: [], trips: [], recurring: [],
    categories: [{ id: "food", name: "Food", icon: "cafe-outline", color: "#E47850", kind: "expense" }],
    transactions: [{ id: "t", title: "Sample", kind: "expense", total, share, categoryId: "food", date: "2026-10-01", note: "" }],
  });
  const bounds: [unknown, unknown][] = [
    [1, 0], [1, 1], [0, 0], [99999999999, 99999999999], [100000000000, 0], [500, 501], [1.5, 1], [-1, 0], [500, -1],
  ];
  const ledgerAmounts = bounds.map(([total, share]) => ({
    total, share, valid: ledgerWriteSchema.safeParse({ revision: 0, ledger: entry(total, share) }).success,
  }));
  return { generator, description: "Integer-cent money: client amount parsing (cents), personal share entry, and the stored entry total/share bounds every server enforces.", parse, personalShares, ledgerAmounts };
}

function recurrence() {
  const starts: [string, Frequency, number][] = [
    ["2025-01-31", "monthly", 31], ["2025-02-28", "monthly", 31], ["2024-01-31", "monthly", 31], ["2024-02-29", "monthly", 29],
    ["2026-01-30", "monthly", 30], ["2026-03-31", "monthly", 31], ["2026-04-30", "monthly", 31], ["2026-12-31", "monthly", 31],
    ["2026-01-15", "monthly", 15], ["2024-02-29", "yearly", 29], ["2025-02-28", "yearly", 29], ["2026-10-31", "yearly", 31],
    ["2026-12-29", "weekly", 29], ["2024-02-26", "weekly", 26], ["2026-03-06", "weekly", 6], ["2026-10-30", "weekly", 30],
  ];
  const next = starts.map(([date, frequency, anchorDay]) => ({ date, frequency, anchorDay, next: nextOccurrence(date, frequency, anchorDay) }));
  // Following the anchor (not the clamped date) over many steps never drifts.
  const sequences = ([["2026-01-31", "monthly", 31], ["2024-02-29", "yearly", 29], ["2026-08-30", "monthly", 30], ["2026-12-28", "weekly", 28]] as [string, Frequency, number][])
    .map(([start, frequency, anchorDay]) => {
      const dates = [start];
      while (dates.length < 13) dates.push(nextOccurrence(dates.at(-1)!, frequency, anchorDay));
      return { start, frequency, anchorDay, dates };
    });
  return { generator, description: "Recurrence: next occurrence by frequency and anchor day (short months, leap years, year ends, DST weeks) and 12-step sequences that keep the anchor.", next, sequences };
}

function ledger(transactions: object[], extra: Partial<Ledger> = {}): Ledger {
  return {
    version: 4, currency: "CAD", accounts: [{ id: "chq", name: "Chequing", type: "bank" }], trips: [], recurring: [],
    categories: [{ id: "food", name: "Food", icon: "cafe-outline", color: "#E47850", kind: "expense" }],
    transactions: transactions as Ledger["transactions"], ...extra,
  };
}

// Personal recurrence after an offline catch-up (docs/ios-offline-sync.md): the base was synced
// with the pass due Nov 1; this device then recorded Nov 1 and moved the rule to Dec 1 offline.
function recurringMergeCases() {
  const pass = { id: "pass", title: "Transit pass", kind: "expense", total: 15600, share: 15600, categoryId: "food", accountId: "chq", date: "2026-10-01", note: "", frequency: "monthly", nextDate: "2026-11-01", anchorDay: 1, active: true } as const;
  const nov = { id: "pass:2026-11-01", title: "Transit pass", kind: "expense", total: 15600, share: 15600, categoryId: "food", accountId: "chq", date: "2026-11-01", note: "", recurringId: "pass" } as const;
  const dec = { ...nov, id: "pass:2026-12-01", date: "2026-12-01" };
  const base = ledger([], { recurring: [pass] });
  const caughtUp = ledger([nov], { recurring: [{ ...pass, nextDate: "2026-12-01" }] });
  return [
    { name: "recurring: a rule deleted remotely stays deleted after a local catch-up, with its untouched occurrence", base, local: caughtUp, remote: ledger([]) },
    { name: "recurring: a rule deleted remotely comes back when edited locally", base, local: ledger([nov], { recurring: [{ ...pass, nextDate: "2026-12-01", total: 16000, share: 16000 }] }), remote: ledger([]) },
    { name: "recurring: the later nextDate wins when both sides caught up", base, local: caughtUp, remote: ledger([nov, dec], { recurring: [{ ...pass, nextDate: "2027-01-01" }] }) },
    { name: "recurring: an occurrence both sides recorded keeps the server's edit", base, local: caughtUp, remote: ledger([{ ...nov, note: "Edited elsewhere" }], { recurring: [{ ...pass, nextDate: "2026-12-01" }] }) },
    { name: "recurring: an untouched occurrence the server recorded and deleted is dropped", base, local: caughtUp, remote: ledger([], { recurring: [{ ...pass, nextDate: "2026-12-01" }] }) },
  ];
}

function merge() {
  const lunch = { id: "lunch", title: "Lunch", kind: "expense", total: 1200, share: 1200, categoryId: "food", date: "2026-10-01", note: "" };
  const taxi = { id: "taxi", title: "Taxi", kind: "expense", total: 2000, share: 2000, categoryId: "food", date: "2026-10-02", note: "" };
  const base = ledger([lunch, taxi]);
  const cases: { name: string; base: Ledger; local: Ledger; remote: Ledger }[] = [
    { name: "independent fields both survive", base, local: ledger([{ ...lunch, note: "Local note" }, taxi]), remote: ledger([{ ...lunch, total: 1500, share: 1500 }, taxi]) },
    { name: "same field: the local edit wins", base, local: ledger([{ ...lunch, title: "Local lunch" }, taxi]), remote: ledger([{ ...lunch, title: "Remote lunch" }, taxi]) },
    { name: "local delete removes a remotely edited entry", base, local: ledger([taxi]), remote: ledger([{ ...lunch, note: "Remote" }, taxi]) },
    { name: "local edit restores an entry deleted remotely", base, local: ledger([{ ...lunch, note: "Kept" }, taxi]), remote: ledger([taxi]) },
    { name: "unchanged local entry follows a remote delete", base, local: base, remote: ledger([taxi]) },
    { name: "local create is appended after remote entries", base, local: ledger([lunch, taxi, { ...taxi, id: "new", title: "New" }]), remote: ledger([lunch, taxi, { ...taxi, id: "remote-new", title: "Remote new" }]) },
    { name: "local field removal (unlink account) survives a remote note", base: ledger([{ ...lunch, accountId: "chq" }, taxi]), local: ledger([lunch, taxi]), remote: ledger([{ ...lunch, accountId: "chq", note: "Remote" }, taxi]) },
    { name: "currency: local change wins, otherwise remote", base, local: ledger([lunch, taxi], { currency: "USD" }), remote: ledger([lunch, taxi], { currency: "EUR" }) },
    { name: "remote currency change kept when local unchanged", base, local: base, remote: ledger([lunch, taxi], { currency: "EUR" }) },
    { name: "category rename merges with an entry edit", base, local: ledger([lunch, { ...taxi, note: "Airport" }]), remote: ledger([lunch, taxi], { categories: [{ id: "food", name: "Groceries & dining", icon: "cafe-outline", color: "#E47850", kind: "expense" }] }) },
    ...recurringMergeCases(),
  ];
  return {
    generator,
    description: "Three-way ledger merge (offline sync after a 409): base is the last synced server ledger, local the unsynced device ledger, remote the newer server ledger.",
    cases: cases.map((item) => ({ ...item, expected: JSON.parse(JSON.stringify(mergeLedger(item.base, item.local, item.remote))) })),
  };
}

// Which suites consume each fixture. A language with no implementation yet names the
// issue that adds it; a fixture only meaningful to some layers says so.
const consumers: Record<string, Record<string, string[] | string>> = {
  "money.json": { typescript: ["tests/core/golden-fixtures.test.ts"], csharp: ["apps/backend/tests/Penny.Backend.UnitTests/Contracts/GoldenFixtureTests.cs"], swift: ["contracts/swift/Tests/PennyContractsTests/FixtureDecodingTests.swift"] },
  "recurrence.json": { typescript: ["tests/core/golden-fixtures.test.ts"], csharp: ["apps/backend/tests/Penny.Backend.UnitTests/Contracts/GoldenFixtureTests.cs"], swift: ["contracts/swift/Tests/PennyContractsTests/FixtureDecodingTests.swift"] },
  "merge-conflicts.json": { typescript: ["tests/core/golden-fixtures.test.ts"], csharp: "not applicable: the server never merges; it rejects stale writes with 409 (http-journey.json)", swift: ["contracts/swift/Tests/PennyContractsTests/FixtureDecodingTests.swift", "apps/ios/Packages/PennyKit/Tests/PennyDomainTests/LedgerMergeTests.swift"] },
  "parity-cases.json": { typescript: ["tests/core/contracts.test.ts"], csharp: ["apps/backend/tests/Penny.Backend.UnitTests/Households/HouseholdSplitsTests.cs"], swift: ["contracts/swift/Tests/PennyContractsTests/FixtureDecodingTests.swift"] },
  "shared-splits.json": { typescript: ["tests/core/households-domain.test.ts"], csharp: ["apps/backend/tests/Penny.Backend.UnitTests/Households/HouseholdSplitsTests.cs"], swift: ["contracts/swift/Tests/PennyContractsTests/FixtureDecodingTests.swift"] },
  "settlement.json": { typescript: ["tests/core/households-domain.test.ts"], csharp: ["apps/backend/tests/Penny.Backend.UnitTests/Households/MonthlySettlementTests.cs"], swift: "MAZ-75 (shared settlement in Swift)" },
  "ledger-upgrades.json": { typescript: ["tests/core/contracts.test.ts"], csharp: ["apps/backend/tests/Penny.Backend.UnitTests/Ledgers/LedgerReaderTests.cs", "apps/backend/tests/Penny.Backend.IntegrationTests/Contracts/LedgerUpgradeFixtureTests.cs"], swift: ["contracts/swift/Tests/PennyContractsTests/FixtureDecodingTests.swift"] },
  "search-cases.json": { typescript: ["tests/core/contracts.test.ts", "tests/core/transactions.test.ts"], csharp: ["apps/backend/tests/Penny.Backend.UnitTests/Search/SearchTextTests.cs", "apps/backend/tests/Penny.Backend.IntegrationTests/Controllers/SearchFixtureTests.cs"], swift: "MAZ-73 (search screens and offline normalization in Swift)" },
  "http-journey.json": { typescript: ["tests/core/contracts.test.ts"], csharp: ["apps/backend/tests/Penny.Backend.IntegrationTests/Controllers/LedgerTests.cs"], swift: "MAZ-71 (Swift API client)" },
  "storage-mapping.json": { typescript: ["tests/core/contracts.test.ts"], csharp: ["apps/backend/tests/Penny.Backend.IntegrationTests/Migrations/SqliteImportTests.cs"], swift: "not applicable: server storage" },
  "full-stack-seeds.json": { typescript: ["tests/core/golden-fixtures.test.ts", "tests/core/parity-coverage.test.ts", "tests/fullstack/environment.test.mjs"], csharp: ["apps/backend/tests/Penny.Backend.IntegrationTests/Contracts/FullStackSeedTests.cs"], swift: ["contracts/swift/Tests/PennyContractsTests/FixtureDecodingTests.swift"] },
  "redesign-states.json": { typescript: ["tests/core/golden-fixtures.test.ts"], csharp: "not applicable: client presentation states", swift: ["contracts/swift/Tests/PennyContractsTests/FixtureDecodingTests.swift"] },
};

export function serialize(value: unknown): string {
  // Non-ASCII is escaped so the bytes (and hashes) never depend on an editor's encoding.
  return `${JSON.stringify(value, null, 2).replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)}\n`;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

export function generated(): Record<string, string> {
  return {
    "money.json": serialize(money()),
    "recurrence.json": serialize(recurrence()),
    "merge-conflicts.json": serialize(merge()),
  };
}

export function manifest(files: Record<string, string>): string {
  const read = (name: string) => files[name] ?? readFileSync(new URL(name, directory), "utf8");
  return serialize({
    version: 1,
    description: "Every shared fixture, its SHA-256 (LF line endings) and the suites consuming it. Regenerate with `node --experimental-strip-types scripts/fixtures/generate-golden.ts`; tests in each language verify the hashes, so an unreviewed edit fails everywhere.",
    fixtures: Object.keys(consumers).sort().map((file) => ({
      file, sha256: sha256(read(file)), generatedBy: file in files ? generator : null, consumers: consumers[file],
    })),
  });
}

if (import.meta.main) {
  const files = generated();
  const all = { ...files, "manifest.json": manifest(files) };
  const check = process.argv.includes("--check");
  const stale = Object.entries(all).filter(([name, text]) => {
    let current = "";
    try {
      current = readFileSync(new URL(name, directory), "utf8");
    } catch {
      // Missing counts as stale.
    }
    return current.replace(/\r\n/g, "\n") !== text;
  });
  if (check) {
    if (stale.length) {
      console.error(`Stale fixtures: ${stale.map(([name]) => name).join(", ")}. Regenerate with node --experimental-strip-types ${generator}`);
      process.exit(1);
    }
    console.log("Golden fixtures and manifest are current.");
  } else {
    for (const [name, text] of stale) writeFileSync(new URL(name, directory), text);
    console.log(stale.length ? `Wrote ${stale.map(([name]) => name).join(", ")}` : "Nothing to change.");
  }
}
