// MAZ-62 shared golden fixtures, consumed through strict typed models: an unknown,
// missing or mistyped field fails here just as it does in the C# and Swift suites.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { cents, nextOccurrence, personalShare, type Ledger } from "../../src/domain/ledger.ts";
import { mergeLedger } from "../../src/domain/merge.ts";
import { calculateHouseholdSplits } from "../../src/domain/households.ts";
import { ledgerWriteSchema } from "../../server/validation/ledger.ts";
import { selectTransactions } from "../../src/features/transactions/selectors.ts";
import { generated, manifest, sha256 } from "../../scripts/fixtures/generate-golden.ts";
import { applyPendingEdits } from "../../scripts/test-env/seed.mjs";

const root = new URL("../../", import.meta.url);
const text = (name: string) => readFileSync(new URL(`contracts/fixtures/${name}`, root), "utf8");
const parse = <T>(schema: z.ZodType<T>, name: string): T => schema.parse(JSON.parse(text(name)));

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const frequency = z.enum(["weekly", "monthly", "yearly"]);
const shareMode = z.enum(["full", "equal", "amount", "percent"]);

const Money = z.strictObject({
  generator: z.string(),
  description: z.string(),
  parse: z.array(z.union([
    z.strictObject({ input: z.string(), cents: z.number().int().nonnegative() }),
    z.strictObject({ input: z.string(), error: z.string().min(1) }),
  ])).min(10),
  personalShares: z.array(z.union([
    z.strictObject({ total: z.number().int().positive(), mode: shareMode, input: z.string(), share: z.number().int().nonnegative() }),
    z.strictObject({ total: z.number().int().positive(), mode: shareMode, input: z.string(), error: z.string().min(1) }),
  ])).min(10),
  ledgerAmounts: z.array(z.strictObject({ total: z.number(), share: z.number(), valid: z.boolean() })).min(5),
});

const Recurrence = z.strictObject({
  generator: z.string(),
  description: z.string(),
  next: z.array(z.strictObject({ date, frequency, anchorDay: z.number().int().min(1).max(31), next: date })).min(10),
  sequences: z.array(z.strictObject({ start: date, frequency, anchorDay: z.number().int().min(1).max(31), dates: z.array(date).length(13) })).min(3),
});

const LedgerShape = z.custom<Ledger>((value) => ledgerWriteSchema.safeParse({ revision: 0, ledger: value }).success, "a valid v4 ledger");
const Merge = z.strictObject({
  generator: z.string(),
  description: z.string(),
  cases: z.array(z.strictObject({ name: z.string(), base: LedgerShape, local: LedgerShape, remote: LedgerShape, expected: LedgerShape })).min(5),
});

const Manifest = z.strictObject({
  version: z.literal(1),
  description: z.string(),
  fixtures: z.array(z.strictObject({
    file: z.string().regex(/^[a-z-]+\.json$/),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    generatedBy: z.string().nullable(),
    consumers: z.strictObject({
      typescript: z.array(z.string()).min(1),
      csharp: z.union([z.array(z.string()).min(1), z.string().min(1)]),
      swift: z.union([z.array(z.string()).min(1), z.string().min(1)]),
    }),
  })),
});

const reference = z.string().regex(/^\$(user|household|expense):[a-z0-9-]+$/);
// "$today" dates (real-time scenarios) are checked as a concrete day.
const SeedLedger = z.custom<Ledger>((value) => value !== undefined &&
  ledgerWriteSchema.safeParse({ revision: 0, ledger: JSON.parse(JSON.stringify(value).replaceAll("$today", "2026-01-15")) }).success, "a valid v4 ledger");
const Step = z.union([
  z.strictObject({ clock: z.iso.datetime() }),
  z.strictObject({ as: z.string(), ledger: SeedLedger }),
  z.strictObject({ as: z.string(), rename: z.partialRecord(z.enum(["categories", "accounts", "trips"]), z.record(z.string(), z.string().min(1))) }),
  z.strictObject({ as: z.string(), createHousehold: z.strictObject({ ref: z.string(), name: z.string(), currency: z.string(), timezoneOffsetMinutes: z.number().int() }) }),
  z.strictObject({ as: z.string(), createTrip: z.strictObject({ ref: z.string(), name: z.string(), currency: z.string(), startDate: date, endDate: date, timezoneOffsetMinutes: z.number().int() }) }),
  z.strictObject({ as: z.string(), invite: z.strictObject({ household: z.string(), ref: z.string() }) }),
  z.strictObject({ as: z.string(), join: z.strictObject({ invite: z.string(), timezoneOffsetMinutes: z.number().int() }) }),
  z.strictObject({ as: z.string(), expense: z.strictObject({ household: z.string(), ref: z.string(), body: z.record(z.string(), z.unknown()) }) }),
  z.strictObject({ as: z.string(), sharedRecurring: z.strictObject({ household: z.string(), ref: z.string(), body: z.record(z.string(), z.unknown()) }) }),
  z.strictObject({ as: z.string(), reimburse: z.strictObject({ household: z.string(), month: z.string().regex(/^\d{4}-\d{2}$/), fromUserId: reference, toUserId: reference, amountCents: z.number().int().positive() }) }),
  z.strictObject({ as: z.string(), leave: z.strictObject({ household: z.string() }) }),
]);
const SearchExpectation = z.strictObject({
  as: z.string(),
  request: z.strictObject({ query: z.string() }),
  keys: z.array(z.string().regex(/^(personal:[a-z0-9-]+|shared:\$expense:[a-z0-9-]+)$/)),
  matches: z.array(z.enum(["title", "text", "typo", "meaning"]).nullable()),
  meaningAllowedAfter: z.boolean(),
  excludes: z.array(z.string()),
  why: z.string().min(1),
});
const Seeds = z.strictObject({
  version: z.literal(1),
  description: z.string(),
  scenarios: z.array(z.strictObject({
    name: z.string().regex(/^[a-z-]+$/),
    summary: z.string(),
    clock: z.union([z.iso.datetime(), z.literal("$now")]),
    users: z.array(z.string().regex(/^[a-z]+$/)).min(1),
    steps: z.array(Step),
    searchExpectations: z.array(SearchExpectation).optional(),
    probes: z.array(z.strictObject({
      name: z.string().min(1),
      as: z.string().optional(),
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
      path: z.string().startsWith("/api/"),
      body: z.unknown().optional(),
    })).optional(),
    knownDifferences: z.array(z.strictObject({ probe: z.string(), path: z.string(), reason: z.string().min(1) })).optional(),
    pendingEdits: z.strictObject({
      as: z.string(),
      description: z.string(),
      create: z.array(z.record(z.string(), z.unknown())),
      edit: z.array(z.strictObject({ id: z.string(), patch: z.record(z.string(), z.unknown()) })),
      delete: z.array(z.string()),
      localSearch: z.array(z.strictObject({ query: z.string(), expectedIds: z.array(z.string()) })),
    }).optional(),
  })).min(2),
});

const Totals = z.strictObject({ expenseCents: z.number().int(), incomeCents: z.number().int(), investmentCents: z.number().int() });
const Redesign = z.strictObject({
  version: z.literal(2),
  description: z.string(),
  clock: z.iso.datetime(),
  palettes: z.array(z.enum(["light", "dark"])).length(2),
  totals: z.record(z.string(), z.strictObject({
    description: z.string(),
    recorded: Totals,
    scheduled: z.array(z.strictObject({ source: z.enum(["personal", "shared"]), title: z.string(), date, shareCents: z.number().int() })),
    projected: Totals,
  })),
  states: z.array(z.strictObject({
    specimen: z.string(),
    platform: z.string(),
    appearances: z.array(z.enum(["light", "dark"])).min(1),
    scenario: z.string().nullable(),
    as: z.string().optional(),
    client: z.enum(["signed-out", "static"]).optional(),
    oidc: z.boolean().optional(),
    view: z.string().min(1),
    totals: z.string().optional(),
    month: z.string().optional(),
    search: z.strictObject({ query: z.string() }).optional(),
    blockedBy: z.string().optional(),
    fault: z.record(z.string(), z.unknown()).optional(),
    expect: z.strictObject({ status: z.number().int(), retryStatus: z.number().int() }).optional(),
    staleWrite: z.strictObject({
      method: z.string(),
      path: z.string(),
      requests: z.array(z.strictObject({ body: z.record(z.string(), z.unknown()), expectStatus: z.number().int(), expectError: z.string().optional() })).min(2),
    }).optional(),
  })),
});

test("money fixtures match the legacy parser, personal shares and ledger bounds", () => {
  const golden = parse(Money, "money.json");
  for (const item of golden.parse)
    if ("error" in item) assert.throws(() => cents(item.input), { message: item.error }, item.input);
    else assert.equal(cents(item.input), item.cents, item.input);
  for (const item of golden.personalShares)
    if ("error" in item) assert.throws(() => personalShare(item.total, item.mode, item.input), { message: item.error });
    else assert.equal(personalShare(item.total, item.mode, item.input), item.share);
  const ledger = (total: number, share: number) => ({
    version: 4, currency: "CAD", accounts: [], trips: [], recurring: [],
    categories: [{ id: "food", name: "Food", icon: "cafe-outline", color: "#E47850", kind: "expense" }],
    transactions: [{ id: "t", title: "Sample", kind: "expense", total, share, categoryId: "food", date: "2026-10-01", note: "" }],
  });
  for (const item of golden.ledgerAmounts)
    assert.equal(ledgerWriteSchema.safeParse({ revision: 0, ledger: ledger(item.total, item.share) }).success, item.valid, JSON.stringify(item));
});

test("recurrence fixtures match next occurrence and keep the anchor", () => {
  const golden = parse(Recurrence, "recurrence.json");
  for (const item of golden.next) assert.equal(nextOccurrence(item.date, item.frequency, item.anchorDay), item.next, JSON.stringify(item));
  for (const item of golden.sequences)
    for (let index = 1; index < item.dates.length; index++)
      assert.equal(nextOccurrence(item.dates[index - 1], item.frequency, item.anchorDay), item.dates[index]);
});

test("merge-conflict fixtures match the offline three-way merge", () => {
  for (const item of parse(Merge, "merge-conflicts.json").cases)
    assert.deepEqual(JSON.parse(JSON.stringify(mergeLedger(item.base, item.local, item.remote))), item.expected, item.name);
});

test("fixture manifest hashes every shared fixture and names each consumer", () => {
  const golden = parse(Manifest, "manifest.json");
  const files = readdirFixtures();
  assert.deepEqual(golden.fixtures.map((item) => item.file), files, "every fixture is in the manifest");
  for (const item of golden.fixtures) {
    assert.equal(sha256(text(item.file)), item.sha256, `${item.file} changed without regenerating the manifest`);
    for (const path of [item.consumers.typescript, item.consumers.csharp, item.consumers.swift].flat())
      if (path.includes("/")) assert.ok(readFileSync(new URL(path, root)).length > 0, `${item.file} consumer ${path} exists`);
  }
});

function readdirFixtures(): string[] {
  const listed = spawnSync("git", ["ls-files", "--others", "--cached", "--exclude-standard", "contracts/fixtures"], { cwd: root, encoding: "utf8" });
  return listed.stdout.split("\n").filter((line) => /^contracts\/fixtures\/[a-z-]+\.json$/.test(line) && !line.endsWith("/manifest.json"))
    .map((line) => line.slice("contracts/fixtures/".length)).sort();
}

test("golden fixtures regenerate byte-for-byte in any time zone", () => {
  const files = generated();
  for (const [name, content] of Object.entries(files)) assert.equal(content, text(name).replace(/\r\n/g, "\n"), name);
  assert.equal(manifest(files), text("manifest.json").replace(/\r\n/g, "\n"));
  for (const zone of ["Pacific/Kiritimati", "America/St_Johns", "Australia/Lord_Howe"]) {
    const run = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/fixtures/generate-golden.ts", "--check"], {
      cwd: root, env: { ...process.env, TZ: zone }, encoding: "utf8",
    });
    assert.equal(run.status, 0, `${zone}: ${run.stderr}`);
  }
});

test("full-stack seeds are well formed, sanitized and internally consistent", () => {
  const seeds = parse(Seeds, "full-stack-seeds.json");
  const raw = text("full-stack-seeds.json");
  // Synthetic data only: no addresses, tokens or passwords live in the fixture.
  assert.doesNotMatch(raw, /@(?!penny\.test)[a-z0-9.-]+\.[a-z]{2,}/i);
  assert.doesNotMatch(raw, /"(password|token|code)"\s*:/);
  for (const scenario of seeds.scenarios) {
    const defined = { user: new Set(scenario.users), household: new Set<string>(), expense: new Set<string>(), invite: new Set<string>() };
    for (const step of scenario.steps) {
      if ("as" in step) assert.ok(defined.user.has(step.as), `${scenario.name}: unknown alias ${step.as}`);
      const refs = JSON.stringify(step).match(/\$(user|household|expense):[a-z0-9-]+/g) ?? [];
      for (const ref of refs) {
        const [kind, name] = ref.slice(1).split(":") as ["user" | "household" | "expense", string];
        assert.ok(defined[kind].has(name), `${scenario.name}: ${ref} used before it is defined`);
      }
      if ("createHousehold" in step) defined.household.add(step.createHousehold.ref);
      if ("createTrip" in step) defined.household.add(step.createTrip.ref);
      if ("invite" in step) {
        assert.ok(defined.household.has(step.invite.household));
        defined.invite.add(step.invite.ref);
      }
      if ("join" in step) assert.ok(defined.invite.has(step.join.invite));
      if ("expense" in step) defined.expense.add(step.expense.ref);
    }
    for (const probe of scenario.probes ?? []) {
      if (probe.as) assert.ok(defined.user.has(probe.as), `${probe.name}: alias`);
      for (const ref of JSON.stringify(probe).match(/\$(user|household|expense):[a-z0-9-]+/g) ?? []) {
        const [kind, name] = ref.slice(1).split(":") as ["user" | "household" | "expense", string];
        assert.ok(defined[kind].has(name), `${probe.name}: ${ref}`);
      }
    }
    for (const item of scenario.searchExpectations ?? []) {
      assert.ok(defined.user.has(item.as));
      assert.equal(item.keys.length, item.matches.length, item.why);
      for (const key of [...item.keys, ...item.excludes]) {
        const expense = /^shared:\$expense:(.+)$/.exec(key)?.[1];
        if (expense) assert.ok(defined.expense.has(expense), `${key} is seeded`);
      }
    }
  }
});

test("pending offline edits produce the published local search results", () => {
  const scenario = parse(Seeds, "full-stack-seeds.json").scenarios.find((item) => item.pendingEdits)!;
  const pending = scenario.pendingEdits!;
  // The server ledger after the seed: the last full ledger plus renames.
  const ledger = structuredClone([...scenario.steps].reverse().find((step) => "ledger" in step && step.as === pending.as)) as { ledger: Ledger };
  for (const step of scenario.steps)
    if ("rename" in step && step.as === pending.as)
      for (const [kind, names] of Object.entries(step.rename))
        for (const item of ledger.ledger[kind as "categories"]) if (item.id in names) item.name = names[item.id];
  const local = applyPendingEdits(ledger.ledger, pending) as Ledger;
  assert.equal(ledgerWriteSchema.safeParse({ revision: 0, ledger: local }).success, true);
  const month = scenario.clock.slice(0, 7);
  for (const item of pending.localSearch) {
    const selected = selectTransactions(local, { month, period: "month", filter: "all", search: item.query, page: 0 });
    assert.deepEqual(selected.visibleEntries.map((entry) => entry.id), item.expectedIds, item.query);
  }
});

test("redesign states cover all 61 cards with seeded, consistent data", () => {
  const states = parse(Redesign, "redesign-states.json");
  const baseline = JSON.parse(readFileSync(new URL("contracts/design-baseline.json", root), "utf8"));
  const seeds = parse(Seeds, "full-stack-seeds.json");
  assert.deepEqual(states.palettes, baseline.appearances);
  assert.deepEqual(states.palettes, Object.keys(baseline.tokens.palettes));
  assert.deepEqual(states.states.map((item) => item.specimen), baseline.specimens.map((item: { id: string }) => item.id));
  for (const state of states.states) {
    const specimen = baseline.specimens.find((item: { id: string }) => item.id === state.specimen);
    assert.equal(state.platform, specimen.platform);
    // A card drawn in dark (Home · Dark, the receipt viewer) pins it; every other card is captured in both.
    if (specimen.theme !== "light") assert.deepEqual(state.appearances, [specimen.theme]);
    else assert.deepEqual(state.appearances, states.palettes, `${state.specimen} renders in light and dark`);
    if (state.scenario === null) assert.ok(state.client, `${state.specimen} without a scenario is a client-only state`);
    else {
      const scenario = seeds.scenarios.find((item) => item.name === state.scenario);
      assert.ok(scenario, `${state.specimen}: scenario ${state.scenario}`);
      assert.ok(scenario.users.includes(state.as!), `${state.specimen}: alias ${state.as}`);
    }
    if (state.totals) assert.ok(states.totals[state.totals]);
  }
  for (const required of ["iphone-payment-stale", "iphone-save-error", "iphone-offline", "iphone-home-dark"])
    assert.ok(states.states.some((item) => item.specimen === required && (item.fault || item.staleWrite || item.appearances.length === 1)));

  // Recorded and projected totals recomputed from the seed itself.
  const scenario = seeds.scenarios.find((item) => item.name === "searchable-household")!;
  const total = states.totals["alex-2026-10"];
  const month = "2026-10";
  const ledger = ([...scenario.steps].reverse().find((step) => "ledger" in step && step.as === "alex") as { ledger: Ledger }).ledger;
  const sum = (kind: string) => ledger.transactions.filter((entry) => entry.kind === kind && entry.date.startsWith(month)).reduce((acc, entry) => acc + entry.share, 0);
  // Members on the expense date: everyone who joined before it and had not left.
  const members = (when: string) => when < "2026-10-02" ? ["alex", "bea", "cam"] : ["alex", "bea"];
  let shared = 0;
  for (const step of scenario.steps) {
    if (!("expense" in step)) continue;
    const body = step.expense.body as { date: string; totalCents: number; splitMode: string; allocations?: { userId: string; amountCents: number }[] };
    if (!body.date.startsWith(month)) continue;
    const splits = body.splitMode === "equal"
      ? calculateHouseholdSplits(body.totalCents, { mode: "equal", memberIds: members(body.date) })
      : body.allocations!.map((item) => ({ userId: item.userId.replace("$user:", ""), amountCents: item.amountCents }));
    shared += splits.find((item) => item.userId === "alex")?.amountCents ?? 0;
  }
  assert.deepEqual(total.recorded, { expenseCents: sum("expense") + shared, incomeCents: sum("income"), investmentCents: sum("investment") });
  const scheduled = total.scheduled.reduce((acc, item) => acc + item.shareCents, 0);
  assert.deepEqual(total.projected, { ...total.recorded, expenseCents: total.recorded.expenseCents + scheduled });
  const gym = ledger.recurring.find((rule) => rule.id === "r-gym")!;
  assert.deepEqual(total.scheduled.find((item) => item.source === "personal"), { source: "personal", title: gym.title, date: gym.nextDate, shareCents: gym.share });
});
