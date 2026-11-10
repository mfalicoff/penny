// SQLite → PostgreSQL cutover rehearsal (MAZ-64), following
// docs/migration/postgresql.md#cutover-and-forward-only-recovery on synthetic,
// production-shaped data:
//
// 1. Build the dataset through the unchanged legacy HTTP API, month by month in the
//    past (legacy-clock.mjs): skewed ledger sizes, receipts, two households and a
//    shared trip with members joining at different times, every split mode, share
//    payments, settled and overdue months, a member who left, rules and devices.
// 2. Record every read each user can make, with their current legacy session token.
// 3. Freeze: stop the legacy server and seal the SQLite file (`snapshot-sqlite`).
// 4. Import into an empty PostgreSQL target (dry run, import, verify), rebuild and
//    verify search, and issue a reset code for one imported password account.
// 5. Start .NET and replay every read with the same imported tokens: responses must
//    equal legacy's, except for registered deliberate differences. Then check search,
//    the expired-session refusal and the password reset of an imported account.
//
// Usage: node scripts/test-env/cutover.mjs [--no-build] [--report DIR]
// The data is synthetic (`.test` emails, generated text); no fixture or real data is read.
import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLegacy, differences } from "./compare.mjs";
import { down, root, up } from "./environment.mjs";
import { client } from "./seed.mjs";

// Deterministic data: the same seed builds the same dataset shape on every run.
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const words = ["Épicerie", "Café crème", "Boulangerie", "Pharmacie", "Essence", "Cinéma", "Librairie", "Marché",
  "Restaurant", "Taxi", "Abonnement", "Électricité", "Internet", "Loyer", "東京 ramen", "Pizza 🍕", "Fromagerie", "Gym"];
const categories = { food: "Food", home: "Home", fun: "Fun", travel: "Travel" };
// Entries per user: one heavy ledger, a long tail and an empty one.
const ledgerSizes = [2500, 600, 300, 150, 80, 40, 20, 10, 5, 0];
const day = (date) => date.toISOString().slice(0, 10);
const monthOf = (date) => date.slice(0, 7);

/** Builds the dataset on a legacy server whose clock follows `clockFile`. */
export async function buildLegacyDataset(legacy, clockFile, { tag = randomBytes(3).toString("hex"), seed = 64 } = {}) {
  const next = random(seed);
  const pick = (items) => items[Math.floor(next() * items.length)];
  const request = client(legacy.url);
  // The legacy server's current time (this process keeps real time).
  let serverNow = () => new Date();
  const setClock = async (instant) => {
    const written = Date.now();
    serverNow = instant ? () => new Date(instant.getTime() + Date.now() - written) : () => new Date();
    writeFileSync(clockFile, instant ? instant.toISOString() : "");
    await new Promise((done) => setTimeout(done, 40));
  };
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 2, 9));
  const monthStart = (index) => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1, 9));
  const lastDay = (index) => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index + 1, 0, 12));
  const context = { users: {}, userIds: {}, households: {}, expenses: [], receipts: [], months: [], expiredToken: undefined };
  await setClock(start);

  for (let index = 0; index < ledgerSizes.length; index++) {
    const alias = `u${String(index).padStart(2, "0")}`;
    const email = `${alias}.${tag}@penny.test`;
    const password = randomBytes(12).toString("hex");
    const { body } = await request("POST", "/api/auth/register", { body: { email, password }, expect: [201] });
    context.users[alias] = { email, password, token: body.token };
  }
  const aliases = Object.keys(context.users);
  context.expiredToken = context.users.u09.token;
  // Sessions last 30 days of server time: sign in again after each clock move. u09
  // keeps only its first session, which has expired by the end.
  const refresh = async () => {
    for (const [alias, user] of Object.entries(context.users)) {
      if (alias === "u09") continue;
      const { body } = await request("POST", "/api/auth/login", { body: { email: user.email, password: user.password } });
      user.token = body.token;
    }
  };

  // Personal ledgers, with receipts linked from a few entries of the first users.
  for (const [index, alias] of aliases.entries()) {
    const token = context.users[alias].token;
    const receipts = [];
    for (let count = 0; count < (index < 3 ? 3 : 0); count++) {
      const content = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(512 + Math.floor(next() * 4096))]);
      const { body } = await request("POST", "/api/receipts", {
        token, body: { name: `Reçu ${alias} ${count}.pdf`, mime: "application/pdf", base64: content.toString("base64") }, expect: [201],
      });
      receipts.push(body.id);
      context.receipts.push({ alias, id: body.id, sha256: createHash("sha256").update(content).digest("hex") });
    }
    const current = await request("GET", "/api/ledger", { token });
    const ledger = current.body.ledger;
    ledger.categories.push(...Object.entries(categories).map(([id, name]) => ({ id: `custom-${id}`, name, icon: "pricetag-outline", color: "#678DB1", kind: "expense" })));
    ledger.accounts = Array.from({ length: index % 4 }, (_, n) => ({ id: `acct-${n}`, name: `Compte ${n}`, type: n % 2 ? "credit" : "bank" }));
    ledger.trips = index % 3 === 0 ? [{ id: "trip-0", name: "Vacances", startDate: "2025-07-01", endDate: "2025-07-14" }] : [];
    ledger.transactions = Array.from({ length: ledgerSizes[index] }, (_, n) => {
      const total = 100 + Math.floor(next() * 50_000);
      const kind = n % 23 === 0 ? "income" : "expense";
      return {
        id: `${alias}-e${n}`,
        title: `${pick(words)} ${n % 50}`,
        kind,
        total,
        share: kind === "income" ? total : Math.max(1, Math.floor(total * (next() < 0.3 ? 0.5 : 1))),
        categoryId: kind === "income" ? "salary" : `custom-${pick(Object.keys(categories))}`,
        date: day(new Date(Date.UTC(2021, 0, 1) + Math.floor(next() * 5 * 365) * 86_400_000)),
        note: n % 7 === 0 ? "Note synthétique" : "",
        ...(ledger.accounts.length && n % 3 === 0 ? { accountId: pick(ledger.accounts).id } : {}),
        ...(ledger.trips.length && kind === "expense" && n % 11 === 0 ? { tripId: "trip-0" } : {}),
        ...(receipts.length && n < receipts.length ? { receipt: { id: receipts[n], name: "x", mime: "application/pdf", uri: "x" } } : {}),
      };
    });
    ledger.recurring = index % 2 ? [] : [{
      id: "rent", title: "Loyer perso", kind: "expense", total: 120_000, share: 120_000, categoryId: "custom-home",
      date: day(now), note: "", frequency: "monthly", nextDate: day(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 5))), anchorDay: 5, active: true,
    }];
    await request("PUT", "/api/ledger", { token, body: { revision: current.body.revision, ledger } });
  }

  // Households and the shared trip. Members join at different months.
  const members = {};
  const learn = async (household, token) => {
    const { body } = await request("GET", `/api/households/${household}`, { token });
    for (const member of body.members)
      for (const [alias, user] of Object.entries(context.users))
        if (user.email === member.email) context.userIds[alias] = member.userId;
  };
  const join = async (household, creator, alias) => {
    const { body } = await request("POST", `/api/households/${household}/invites`, { token: context.users[creator].token, expect: [201] });
    await request("POST", "/api/households/join", { token: context.users[alias].token, body: { code: body.code, timezoneOffsetMinutes: 0 } });
    members[household].push({ alias, joinedOn: day(serverNow()) });
  };
  const create = async (name, alias, trip) => {
    const path = trip ? "/api/households/trips" : "/api/households";
    const { body } = await request("POST", path, { token: context.users[alias].token, expect: [201], body: { name, currency: "CAD", timezoneOffsetMinutes: 0, ...(trip ?? {}) } });
    context.households[name] = body.household.id;
    members[body.household.id] = [{ alias, joinedOn: day(serverNow()) }];
    return body.household.id;
  };
  const maison = await create("Maison", "u00");
  for (const alias of ["u01", "u02"]) await join(maison, "u00", alias);
  const coloc = await create("Coloc", "u04");
  for (const alias of ["u05", "u06"]) await join(coloc, "u04", alias);
  await learn(maison, context.users.u00.token);
  await learn(coloc, context.users.u04.token);

  const tripStart = monthStart(2);
  const trip = await create("Lisbonne", "u01", { startDate: day(tripStart), endDate: day(new Date(tripStart.getTime() + 9 * 86_400_000)) });
  await join(trip, "u01", "u03");
  await learn(trip, context.users.u01.token);

  const expense = async (household, month, monthIndex) => {
    const date = day(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1 + Math.floor(next() * 9))));
    const eligible = members[household].filter((member) => member.joinedOn <= date && !member.left).map((member) => member.alias);
    if (!eligible.length) return;
    const payer = pick(eligible);
    const totalCents = 500 + Math.floor(next() * 30_000);
    const mode = pick(["equal", "equal", "exact", "percent"]);
    const ids = eligible.map((alias) => context.userIds[alias]);
    let allocations;
    if (mode === "exact") {
      const base = Math.floor(totalCents / ids.length);
      allocations = ids.map((userId, n) => ({ userId, amountCents: n === 0 ? totalCents - base * (ids.length - 1) : base }));
    } else if (mode === "percent") {
      const base = Math.floor(10_000 / ids.length);
      allocations = ids.map((userId, n) => ({ userId, percentBasisPoints: n === 0 ? 10_000 - base * (ids.length - 1) : base }));
    }
    const { body } = await request("POST", `/api/households/${household}/expenses`, {
      token: context.users[payer].token, expect: [201],
      body: {
        title: `${pick(words)} partagé`, totalCents, date, payerUserId: context.userIds[payer], splitMode: mode,
        ...(allocations ? { allocations } : {}),
        category: { name: "Courses", icon: "cart-outline", color: "#E47850" }, note: monthIndex % 2 ? "" : "Synthétique",
      },
    });
    context.expenses.push({ household, id: body.expense.id });
    // Now and then a debtor pays their own share directly.
    const debtor = eligible.find((alias) => alias !== payer);
    if (debtor && next() < 0.15)
      await request("POST", `/api/households/${household}/expenses/${body.expense.id}/payments`, {
        token: context.users[debtor].token, expect: [201], body: { fromUserId: context.userIds[debtor], revision: body.expense.revision },
      });
  };
  const settle = async (household, month) => {
    const creator = members[household][0].alias;
    const recap = await request("GET", `/api/households/${household}/months/${month}`, { token: context.users[creator].token });
    for (const suggestion of recap.body.suggestions) {
      const from = Object.keys(context.userIds).find((alias) => context.userIds[alias] === suggestion.fromUserId);
      await request("POST", `/api/households/${household}/months/${month}/reimbursements`, {
        token: context.users[from].token, expect: [201], body: suggestion,
      });
    }
  };

  for (let index = 0; index < 5; index++) {
    const month = monthStart(index);
    await setClock(new Date(month.getTime() + 9 * 86_400_000));
    await refresh();
    if (index === 1) {
      // A later member: u07 joins Maison in the second month.
      await join(maison, "u00", "u07");
      await learn(maison, context.users.u00.token);
    }
    for (let count = 0; count < 14; count++) await expense(maison, month, index);
    for (let count = 0; count < 8; count++) await expense(coloc, month, index);
    if (index === 2) for (let count = 0; count < 6; count++) await expense(trip, tripStart, index);
    context.months.push(monthOf(day(month)));
    // Months 0–2 are settled at month end; the last two stay open (one overdue).
    if (index <= 2) {
      await setClock(lastDay(index));
      await settle(maison, context.months[index]);
      await settle(coloc, context.months[index]);
      if (index === 2) {
        await settle(trip, context.months[index]);
        await request("POST", `/api/households/${trip}/leave`, { token: context.users.u03.token });
        members[trip].find((member) => member.alias === "u03").left = true;
      }
    }
  }

  // Shared rules due after the rehearsal (legacy's timer must not race the snapshot).
  await setClock(undefined);
  await refresh();
  const nextMonth = day(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 3)));
  for (const [household, payer, mode] of [[maison, "u00", "equal"], [coloc, "u05", "equal"]])
    await request("POST", `/api/households/${household}/recurring`, {
      token: context.users[payer].token, expect: [201],
      body: { title: "Loyer partagé", totalCents: 180_000, payerUserId: context.userIds[payer], splitMode: mode,
        category: { name: "Logement", icon: "home-outline", color: "#678DB1" }, note: "", nextDate: nextMonth, frequency: "monthly" },
    });

  // Fresh sessions at real time.
  await refresh();
  // Devices last, just before the freeze, so no delivery is attempted.
  for (const alias of ["u00", "u01", "u04"])
    await request("POST", "/api/push/devices", { token: context.users[alias].token, expect: [201], body: { token: `ExponentPushToken[${alias}${tag}]`, platform: "ios" } });
  return context;
}

/** Every read a user can make, as [name, method, path, token]. */
export function reads(context) {
  const list = [];
  const months = [...context.months];
  for (const [alias, user] of Object.entries(context.users)) {
    if (alias === "u09") continue;
    list.push([`${alias} me`, "/api/auth/me", user.token], [`${alias} ledger`, "/api/ledger", user.token], [`${alias} households`, "/api/households", user.token]);
    for (const month of months) list.push([`${alias} projection ${month}`, `/api/households/projection?month=${month}`, user.token]);
    for (const [name, id] of Object.entries(context.households)) {
      list.push([`${alias} ${name}`, `/api/households/${id}`, user.token], [`${alias} ${name} audit`, `/api/households/${id}/audit`, user.token],
        [`${alias} ${name} recurring`, `/api/households/${id}/recurring`, user.token]);
      for (const month of months)
        list.push([`${alias} ${name} expenses ${month}`, `/api/households/${id}/expenses?month=${month}`, user.token],
          [`${alias} ${name} recap ${month}`, `/api/households/${id}/months/${month}`, user.token]);
    }
  }
  for (const { household, id } of context.expenses.filter((_, index) => index % 9 === 0))
    for (const alias of ["u00", "u02", "u05"])
      list.push([`${alias} expense ${id.slice(0, 6)}`, `/api/households/${household}/expenses/${id}`, context.users[alias].token]);
  list.push(["expired session", "/api/auth/me", context.expiredToken]);
  return list.map(([name, path, token]) => ({
    name, path, token, alias: Object.keys(context.users).find((alias) => context.users[alias].token === token),
  }));
}

// Ledger lists have no stored order (docs/migration/ledger.md#storage-mapping-and-read-order).
const unordered = new Set(["accounts", "trips", "categories", "recurring", "transactions"]);
function canonical(value, key) {
  if (Array.isArray(value)) {
    const items = value.map((item) => canonical(item));
    return unordered.has(key) && items.every((item) => typeof item?.id === "string")
      ? items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) : items;
  }
  if (value && typeof value === "object")
    return Object.fromEntries(Object.keys(value).sort().map((name) => [name, canonical(value[name], name)]));
  return value;
}

async function read(url, item) {
  const response = await fetch(url + item.path, { headers: { authorization: `Bearer ${item.token}` } });
  const text = await response.text();
  return { status: response.status, body: canonical(text ? JSON.parse(text) : null) };
}

// Deliberate differences visible on imported data (each documented in its feature
// doc). `path` ignores matching paths; `adjust` rewrites the .NET body before the
// comparison so only the documented change is excused and the rest must still match.
export const knownDifferences = [
  {
    reason: "settlement.md: legacy read the clock twice when a member left, so the former member's own member.left event could fall after their left_at and be hidden; .NET shows it",
    adjust: (legacy, dotnet, readerId) => {
      if (!Array.isArray(legacy?.events) || !Array.isArray(dotnet?.events)) return;
      const seen = new Set(legacy.events.map((event) => event.id));
      dotnet.events = dotnet.events.filter((event) =>
        seen.has(event.id) || event.action !== "member.left" || event.actorId !== readerId);
    },
  },
  {
    reason: "households.md: legacy stored a leave instant in household_members and in household_member_periods from two clock readings; the import keeps the period's, at most a few milliseconds later",
    adjust: (legacy, dotnet) => {
      for (const [index, member] of (dotnet?.members ?? []).entries()) {
        const before = legacy?.members?.[index];
        if (before?.leftAt && member.leftAt && Math.abs(member.leftAt - before.leftAt) <= 50) member.leftAt = before.leftAt;
      }
    },
  },
  { path: /^\/body\/rules\/\d+\/anchorDay$/, reason: "shared-recurrence.md: .NET returns the stored rule with anchorDay" },
  { path: /^\/body\/ledger\/transactions\/\d+\/receipt\/(name|mime|uri)$/, reason: "ledger.md: receipt name, MIME and URI come from the stored receipt, not the client's echo" },
];

/** Runs the whole rehearsal and returns its report. */
export async function rehearseCutover({ build = false, reportDirectory = join(root, "test-results/fullstack/cutover") } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), "penny-cutover-"));
  const clockFile = join(scratch, "clock");
  const timings = {};
  let legacy;
  let state;
  try {
    let started = Date.now();
    legacy = await startLegacy({ clockFile });
    const context = await buildLegacyDataset(legacy, clockFile);
    timings.buildSeconds = (Date.now() - started) / 1000;
    const plan = reads(context);
    const recorded = [];
    for (const item of plan) recorded.push(await read(legacy.url, item));
    for (const receipt of context.receipts) {
      const response = await fetch(`${legacy.url}/api/receipts/${receipt.id}`, { headers: { authorization: `Bearer ${context.users[receipt.alias].token}` } });
      if (createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex") !== receipt.sha256)
        throw new Error("The legacy server did not return the uploaded receipt bytes.");
    }

    // Freeze and seal.
    await legacy.stop({ keep: true });
    const sealed = join(scratch, "sealed.sqlite");
    const resetAccount = context.users.u05;
    const steps = {};
    started = Date.now();
    state = await up({
      build, worker: false,
      prepare: async ({ command }) => {
        const run = (name, args, allowed = [0]) => {
          const result = command(args);
          steps[name] = result.status;
          if (!allowed.includes(result.status)) throw new Error(`${name} failed (${result.status}): ${result.stderr.trim().split("\n").slice(-3).join(" ")}`);
          return result;
        };
        const snapshot = run("snapshot-sqlite", ["snapshot-sqlite", legacy.databasePath, sealed]);
        const hash = (snapshot.stdout + snapshot.stderr).match(/[0-9a-f]{64}/i)?.[0];
        if (!hash) throw new Error("snapshot-sqlite printed no SHA-256.");
        const importStarted = Date.now();
        run("import-sqlite --dry-run", ["import-sqlite", sealed, "--sha256", hash, "--dry-run"]);
        const imported = run("import-sqlite", ["import-sqlite", sealed, "--sha256", hash]);
        timings.importSeconds = (Date.now() - importStarted) / 1000;
        run("import-sqlite --verify", ["import-sqlite", sealed, "--sha256", hash, "--verify"]);
        const searchStarted = Date.now();
        run("search-rebuild", ["search-rebuild"]);
        timings.searchRebuildSeconds = (Date.now() - searchStarted) / 1000;
        run("search-verify", ["search-verify"]);
        run("receipts-verify", ["receipts-verify"]);
        const code = run("reset-password", ["reset-password", resetAccount.email]).stdout.trim();
        return { report: JSON.parse(imported.stdout), code };
      },
    });
    timings.cutoverSeconds = (Date.now() - started) / 1000;

    // Replay every read with the imported tokens.
    const results = [];
    for (const [index, item] of plan.entries()) {
      const left = recorded[index];
      const right = await read(state.apiUrl, item);
      for (const known of knownDifferences) known.adjust?.(left.body, right.body, context.userIds[item.alias]);
      const found = differences(left, right).filter((difference) => !knownDifferences.some((known) => known.path?.test(difference.path)));
      results.push({ name: item.name, path: item.path, legacy: left.status, dotnet: right.status, differences: found });
    }
    const receipts = [];
    for (const receipt of context.receipts) {
      const response = await fetch(`${state.apiUrl}/api/receipts/${receipt.id}`, { headers: { authorization: `Bearer ${context.users[receipt.alias].token}` } });
      receipts.push(response.ok && createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex") === receipt.sha256);
    }
    const request = client(state.apiUrl);
    const search = await request("POST", "/api/v1/search/transactions", { token: context.users.u00.token, body: { query: "boulangerie" } });
    const oldPassword = await request("POST", "/api/auth/login", { body: { email: resetAccount.email, password: resetAccount.password }, expect: [200, 401] });
    const newPassword = randomBytes(12).toString("hex");
    await request("POST", "/api/auth/password-reset", { body: { token: state.prepared.code, password: newPassword } });
    const revoked = await request("GET", "/api/auth/me", { token: resetAccount.token, expect: [200, 401] });
    const signedIn = await request("POST", "/api/auth/login", { body: { email: resetAccount.email, password: newPassword }, expect: [200, 401] });

    const report = {
      summary: {
        users: Object.keys(context.users).length,
        entries: ledgerSizes.reduce((sum, size) => sum + size, 0),
        households: Object.keys(context.households).length,
        sharedExpenses: context.expenses.length,
        receipts: context.receipts.length,
        reads: results.length,
        matching: results.filter((item) => !item.differences.length).length,
      },
      steps,
      importedTables: state.prepared.report.tables ?? state.prepared.report,
      timings,
      checks: {
        receiptsDecrypt: receipts.every(Boolean),
        searchFindsImportedEntries: search.body.totalCount > 0,
        scryptPasswordRefused: oldPassword.status === 401,
        resetRevokesImportedSessions: revoked.status === 401,
        resetPasswordSignsIn: signedIn.status === 200,
      },
      differences: results.flatMap((item) => item.differences.map((difference) =>
        `${item.name} ${difference.path}: legacy ${JSON.stringify(difference.legacy)} vs .NET ${JSON.stringify(difference.dotnet)}`)),
      results,
    };
    writeCutoverReport(report, reportDirectory);
    return report;
  } finally {
    if (state) await down(state.runId);
    legacy?.remove();
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function writeCutoverReport(report, directory, summaryFile = process.env.GITHUB_STEP_SUMMARY) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "cutover-report.json"), JSON.stringify(report, null, 2) + "\n");
  const { summary, timings, checks } = report;
  const lines = [
    "## Cutover rehearsal (SQLite → PostgreSQL)",
    "",
    `${summary.users} users, ${summary.entries} personal entries, ${summary.households} households, ${summary.sharedExpenses} shared expenses, ${summary.receipts} receipts.`,
    `${summary.matching}/${summary.reads} reads match legacy after import.`,
    "",
    "| Step | Exit |", "| --- | --- |",
    ...Object.entries(report.steps).map(([name, status]) => `| \`${name}\` | ${status} |`),
    "",
    "| Check | Result |", "| --- | --- |",
    ...Object.entries(checks).map(([name, ok]) => `| ${name} | ${ok ? "pass" : "**fail**"} |`),
    "",
    `Timings: build ${timings.buildSeconds?.toFixed(1)} s, import ${timings.importSeconds?.toFixed(1)} s, search rebuild ${timings.searchRebuildSeconds?.toFixed(1)} s, environment and cutover ${timings.cutoverSeconds?.toFixed(1)} s.`,
  ];
  if (report.differences.length) lines.push("", "### Differences", "", ...report.differences.slice(0, 50).map((line) => `- \`${line.replaceAll("`", "'")}\``));
  const markdown = lines.join("\n") + "\n";
  writeFileSync(join(directory, "cutover-report.md"), markdown);
  if (summaryFile) writeFileSync(summaryFile, markdown, { flag: "a" });
  return markdown;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const report = await rehearseCutover({ build: !argv.includes("--no-build") });
  console.log(JSON.stringify({ summary: report.summary, steps: report.steps, checks: report.checks, timings: report.timings }, null, 2));
  for (const line of report.differences.slice(0, 50)) console.error(line);
  if (report.differences.length || Object.values(report.checks).some((ok) => !ok)) process.exitCode = 1;
}
