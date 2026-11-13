import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createApp } from "../../server/app.ts";
import { cents, nextOccurrence, personalShare, upgradeLedger } from "../../src/domain/ledger.ts";
import { calculateHouseholdSplits } from "../../src/domain/households.ts";
import { ledgerWriteSchema } from "../../server/validation/ledger.ts";
import { selectTransactions } from "../../src/domain/selectors/transactions.ts";
import { createHash } from "node:crypto";
import { normalizeSearchText } from "./search-normalization.ts";

const root = new URL("../../", import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`contracts/fixtures/${name}`, root), "utf8"));
const spec = JSON.parse(readFileSync(new URL("contracts/openapi.json", root), "utf8"));

function matchesSchema(schema: any, value: unknown): boolean {
  if (schema.$ref) return matchesSchema(spec.components.schemas[schema.$ref.split("/").at(-1)], value);
  if (Array.isArray(schema.type)) return schema.type.some((type: string) => matchesSchema({ ...schema, type }, value));
  if (schema.type === "null") return value === null;
  if (schema.const !== undefined && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.oneOf && schema.oneOf.filter((part: any) => matchesSchema(part, value)).length !== 1) return false;
  if (schema.allOf && schema.allOf.some((part: any) => !matchesSchema(part, value))) return false;
  if (schema.if && matchesSchema(schema.if, value) && schema.then && !matchesSchema(schema.then, value)) return false;
  if (schema.type === "object" || schema.properties || schema.required) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const object = value as Record<string, unknown>;
    if (schema.required?.some((key: string) => !(key in object))) return false;
    if (schema.additionalProperties === false && Object.keys(object).some((key) => !(key in (schema.properties ?? {})))) return false;
    return Object.entries(schema.properties ?? {}).every(([key, property]) => !(key in object) || matchesSchema(property, object[key]));
  }
  if (schema.type === "array") return Array.isArray(value) &&
    (schema.maxItems === undefined || value.length <= schema.maxItems) &&
    value.every((item) => matchesSchema(schema.items, item));
  if (schema.type === "integer") return Number.isInteger(value) &&
    (schema.minimum === undefined || (value as number) >= schema.minimum) &&
    (schema.maximum === undefined || (value as number) <= schema.maximum);
  if (schema.type === "string") return typeof value === "string" &&
    (schema.minLength === undefined || value.length >= schema.minLength) &&
    (schema.maxLength === undefined || value.length <= schema.maxLength) &&
    (!schema.pattern || new RegExp(schema.pattern).test(value));
  if (schema.type === "boolean") return typeof value === "boolean";
  return true;
}

test("OpenAPI covers every current HTTP route and resolves every schema", () => {
  assert.equal(spec.openapi, "3.1.0");
  const prefixes: Record<string, string> = {
    auth: "/api/auth",
    ledger: "/api/ledger",
    households: "/api/households",
    receipts: "/api/receipts",
    push: "/api/push",
  };
  const appSource = readFileSync(new URL("server/app.ts", root), "utf8");
  const actual = [...appSource.matchAll(/\bapp\.(get|post|put|patch|delete)\("([^"]+)"/g)]
    .map(([, method, path]) => `${method} ${path}`);
  for (const [file, prefix] of Object.entries(prefixes)) {
    const source = readFileSync(new URL(`server/http/${file}.ts`, root), "utf8");
    const matches = source.matchAll(/\b(?:router|routes|publicRoutes|protectedRoutes)\.(get|post|put|patch|delete)\((?:"([^"]+)"|'([^']+)')/g);
    for (const [, method, doubleQuoted, singleQuoted] of matches) {
      const route = doubleQuoted ?? singleQuoted;
      const path = `${prefix}${route === "/" ? "" : route}`.replace(/:([A-Za-z]+)\b/g, "{$1}");
      actual.push(`${method} ${path}`);
    }
  }
  const documented = Object.entries(spec.paths).flatMap(([path, operations]) =>
    Object.entries(operations as Record<string, any>).filter(([, operation]) => operation["x-implementation"] === "legacy").map(([method]) => `${method} ${path}`));
  assert.deepEqual(documented.sort(), actual.sort());
  const operationIds = Object.values(spec.paths).flatMap((operations: any) =>
    Object.values(operations).map((operation: any) => operation.operationId));
  assert.equal(new Set(operationIds).size, operationIds.length, "operation IDs are unique");
  for (const [path, operations] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(operations as Record<string, any>)) {
      assert.ok(operation.responses["200"] || operation.responses["201"], `${method} ${path} has a success response`);
      assert.ok(operation.responses.default, `${method} ${path} has an error response`);
      const names = [...path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
      assert.deepEqual(names.sort(), (operation.parameters ?? []).filter((item: any) => item.in === "path").map((item: any) => item.name).sort());
    }
  }
  function checkRefs(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if ("$ref" in value) {
      const ref = (value as { $ref: string }).$ref;
      assert.match(ref, /^#\/components\/schemas\/\w+$/);
      assert.ok(spec.components.schemas[ref.split("/").at(-1)!], `unresolved ${ref}`);
    }
    for (const child of Object.values(value)) checkRefs(child);
  }
  checkRefs(spec.paths);
  checkRefs(spec.components.schemas);
});

test("search fixtures preserve legacy substring, chronology and pending local scope", () => {
  const cases = fixture("search-cases.json");
  assert.equal(ledgerWriteSchema.safeParse({ revision: 0, ledger: cases.ledger }).success, true);
  const select = (ledger: any, item: any) => selectTransactions(ledger, {
    month: "2026-11", period: "month", filter: item.kind ?? "all", search: item.query, page: item.page ?? 0,
  });
  for (const item of cases.substringCases) {
    const selected = select(cases.ledger, item);
    // The existing selector has no day filter; the new API applies it before pagination.
    const entries = item.day ? selected.visibleEntries.filter((entry) => entry.date === item.day) : selected.visibleEntries;
    assert.deepEqual(entries.map((entry) => entry.id), item.ids, item.query);
    if (item.totalCount !== undefined) assert.equal(selected.totalCount, item.totalCount);
    assert.deepEqual(selected.summary, select(cases.ledger, { query: "" }).summary, "query/kind never changes period totals");
  }
  for (const item of cases.pendingCases) {
    const local = structuredClone(cases.ledger);
    if (item.localCreate) local.transactions.push(item.localCreate);
    if (item.editId) Object.assign(local.transactions.find((entry: any) => entry.id === item.editId), item.patch);
    if (item.deleteId) local.transactions = local.transactions.filter((entry: any) => entry.id !== item.deleteId);
    assert.deepEqual(select(local, item).visibleEntries.map((entry) => entry.id), item.expectedIds, item.name);
  }
});

test("search v1 normalization fixtures match the reference normalizer", () => {
  const cases = fixture("search-cases.json");
  assert.ok(cases.foldCases.length >= 20);
  for (const item of cases.foldCases) assert.equal(normalizeSearchText(item.input), item.expected, item.name);
  // Idempotent: normalized text normalizes to itself.
  for (const item of cases.foldCases) assert.equal(normalizeSearchText(item.expected), item.expected, item.name);
});

test("search v1 title and text fixtures agree with local tiers 1-2 on the server ledger", () => {
  const cases = fixture("search-cases.json");
  const ledger = cases.serverLedger;
  assert.equal(ledgerWriteSchema.safeParse({ revision: 0, ledger }).success, true);
  const category = new Map(ledger.categories.map((item: any) => [item.id, item.name]));
  const account = new Map(ledger.accounts.map((item: any) => [item.id, item.name]));
  const local = (query: string) => {
    const needle = normalizeSearchText(query);
    return ledger.transactions
      .map((entry: any) => {
        const document = normalizeSearchText([entry.title, entry.note, category.get(entry.categoryId), entry.accountId ? account.get(entry.accountId) : ""].join(" "));
        const tier = normalizeSearchText(entry.title).includes(needle) ? 1 : document.includes(needle) ? 2 : 0;
        return { key: `personal:${entry.id}`, date: entry.date, tier };
      })
      .filter((item: any) => item.tier > 0)
      .sort((a: any, b: any) => a.tier - b.tier || b.date.localeCompare(a.date) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  };
  let checked = 0;
  for (const item of cases.lexicalCases) {
    if (!item.request.query || !item.matches?.length || item.matches.some((match: string) => match !== "title" && match !== "text")) continue;
    const found = local(item.request.query);
    assert.deepEqual(found.map((row: any) => row.key), item.keys, item.name);
    assert.deepEqual(found.map((row: any) => (row.tier === 1 ? "title" : "text")), item.matches, item.name);
    checked++;
  }
  assert.ok(checked >= 5);
});

test("search v1 schemas accept examples and reject invalid and cross-user requests", () => {
  const cases = fixture("search-cases.json");
  for (const item of cases.requests) assert.ok(matchesSchema(spec.components.schemas.SearchRequest, item), JSON.stringify(item));
  // Schema-level rejections. Date order, real dates and the trimmed query length are
  // service checks (the .NET tests send every invalid request).
  const schemaInvalid = cases.invalidRequests.filter((item: any) =>
    !("from" in item && "to" in item) && item.from !== "2026-02-30" && typeof item.query !== "string");
  for (const item of schemaInvalid) assert.equal(matchesSchema(spec.components.schemas.SearchRequest, item), false, JSON.stringify(item));
  assert.ok(matchesSchema(spec.components.schemas.SearchResponse, cases.response));
  assert.equal(matchesSchema(spec.components.schemas.SearchResponse, { ...cases.response, nextCursor: 12 }), false);
  assert.equal(matchesSchema(spec.components.schemas.SearchResponse, { ...cases.response, items: [{ ...cases.response.items[0], source: "shared" }] }), false);
  assert.equal(matchesSchema(spec.components.schemas.SearchResponse, { ...cases.response, items: [{ ...cases.response.items[0], match: "fuzzy" }] }), false);
  assert.equal(spec.paths["/api/v1/search/transactions"].post["x-implementation"], "backend");
  assert.equal(spec.components.schemas.SearchPeriod, undefined);
});

test("design baseline traces every penny-ios card and design-kit control to feature and acceptance owners", () => {
  const baseline = JSON.parse(readFileSync(new URL("contracts/design-baseline.json", root), "utf8"));
  const file = (path: string) => readFileSync(new URL(path, root));
  const hash = (path: string) => createHash("sha256").update(file(path)).digest("hex");
  assert.equal(baseline.version, 2);
  assert.equal(baseline.design.source, "docs/design/penny-ios");

  // Cards: exactly the @dsCard files on disk, with their marker, viewport and hash.
  const cardFiles = ["iphone", "ipad", "web", "system"].flatMap((dir) =>
    readdirSync(new URL(`docs/design/penny-ios/${dir}/`, root)).filter((name) => name.endsWith(".html")).map((name) => `docs/design/penny-ios/${dir}/${name}`));
  assert.equal(baseline.specimens.length, 61);
  assert.deepEqual(baseline.specimens.map((item: any) => item.sourcePath).sort(), cardFiles.sort());
  assert.equal(new Set(baseline.specimens.map((item: any) => item.id)).size, 61);
  for (const item of baseline.specimens) {
    const [, dir, name] = item.sourcePath.match(/penny-ios\/(\w+)\/([\w-]+)\.html$/);
    assert.equal(item.id, `${dir}-${name}`, "stable id is <folder>-<file>");
    const marker = file(item.sourcePath).toString("utf8").split("\n")[0];
    assert.equal(marker, `<!-- @dsCard group="${item.group}" name="${item.name}" viewport="${item.viewport.w}x${item.viewport.h}" -->`);
    assert.equal(item.sha256, hash(item.sourcePath), `${item.id} changed: re-sync the baseline`);
    assert.ok(["light", "dark"].includes(item.theme));
    if (item.platform === "iPhone" || item.platform === "iPad") assert.match(item.nativeIssue, /^MAZ-\d+$/);
    if (item.platform === "Web") assert.match(item.webIssue, /^MAZ-\d+$/);
  }
  assert.deepEqual(Object.fromEntries(["iPhone", "iPad", "Web", "System"].map((platform) =>
    [platform, baseline.specimens.filter((item: any) => item.platform === platform).length])), { iPhone: 45, iPad: 6, Web: 8, System: 2 });

  // Controls: exactly the documented design-kit components, at the source Claude Design syncs.
  const sync = JSON.parse(file(".design-sync/config.json").toString("utf8"));
  const kitDocs = readdirSync(new URL("design-kit/docs/", root)).filter((name) => name.endsWith(".md")).map((name) => name.slice(0, -3));
  assert.equal(baseline.controls.length, 42);
  assert.deepEqual(baseline.controls.map((item: any) => item.name).sort(), kitDocs.sort());
  for (const item of baseline.controls) {
    assert.equal(item.source, `design-kit/${sync.componentSrcMap[item.name]}`);
    assert.match(file(item.source).toString("utf8"), new RegExp(`export function ${item.name}\\b`));
    assert.equal(item.sha256, hash(item.docPath), `${item.name} docs changed: re-sync the baseline`);
    assert.equal(item.nativeIssue === null, item.category === "Web", `${item.name}: only web-shell controls have no native owner`);
  }

  for (const item of [...baseline.specimens, ...baseline.controls]) {
    assert.ok(item.nativeIssue || item.webIssue);
    for (const side of ["native", "web"] as const) {
      const owner = item[`${side}Issue`];
      if (owner === null) assert.equal(item.acceptance[side], null);
      else {
        assert.match(owner, /^MAZ-\d+$/);
        assert.equal(item.acceptance[side], side === "native" ? "MAZ-82" : "MAZ-96");
      }
    }
    assert.ok(item.acceptance.scenario.length > 20);
    if (item.legacyTest) assert.ok(file(item.legacyTest).length);
  }

  for (const source of baseline.sources) assert.equal(source.sha256, hash(source.path), `${source.path} changed: re-sync the baseline`);
  assert.deepEqual(baseline.appearances, ["light", "dark"]);
  assert.deepEqual(Object.keys(baseline.tokens.palettes), baseline.appearances);
  assert.deepEqual(Object.keys(baseline.tokens.palettes.dark), Object.keys(baseline.tokens.palettes.light));
  assert.equal(baseline.tokens.fonts.web.family, "Inter");
  assert.equal(baseline.tokens.icons.ios.family, "SF Symbols");

  // Every legacy Expo Router screen keeps a destination on each platform. The Expo app is retired
  // (MAZ-98), so this map is now the frozen record of its routes; deep links still arrive on them.
  assert.equal(baseline.navigation.legacyRoutes.length, 12);
  assert.equal(new Set(baseline.navigation.legacyRoutes.map((item: any) => item.route)).size, 12);
  for (const item of baseline.navigation.legacyRoutes) for (const platform of ["iPhone", "iPad", "web"]) assert.ok(item[platform], `${item.route} on ${platform}`);
  for (const item of baseline.specimens) if (item.legacyRoute) assert.ok(baseline.navigation.legacyRoutes.some((route: any) => route.route === item.legacyRoute), item.legacyRoute);

  // New behavior the design implies is filed, and the cards point back at it.
  const ids = new Set(baseline.specimens.map((item: any) => item.id));
  for (const behavior of baseline.behaviorIssues) for (const id of behavior.specimens) {
    assert.ok(ids.has(id), id);
    assert.ok(baseline.specimens.find((item: any) => item.id === id).behaviorIssues.includes(behavior.issue), `${id} lists ${behavior.issue}`);
  }
  for (const item of baseline.specimens) for (const issue of item.behaviorIssues ?? [])
    assert.ok(baseline.behaviorIssues.some((behavior: any) => behavior.issue === issue && behavior.specimens.includes(item.id)));
});

test("storage fixtures preserve exact cents, millisecond dates, binary receipts and explicit import blockers", () => {
  const cases = fixture("storage-mapping.json");
  assert.equal(cases.sourceSchemaVersion, 2);
  assert.equal(cases.targetPostgresqlMajor, 18);
  for (const item of cases.cases) {
    if (item.sqliteBase64) assert.equal(createHash("sha256").update(Buffer.from(item.sqliteBase64, "base64")).digest("hex"), item.sha256);
    else if (item.column === "household_audit.after_json") assert.deepEqual(JSON.parse(item.sqlite), item.postgres);
    else if (!item.error && item.column !== "household_recurring.active") assert.deepEqual(item.sqlite, item.postgres);
  }
  assert.equal(cases.cases.find((item: any) => item.name === "JSONB unsupported NUL blocks import").error, "unsupported-jsonb-text");
  // PostgreSQL execution/import correctness remains MAZ-52/62; these check portable fixtures only.
});

test("sanitized v1–v4 ledger fixtures match current validation and upgrade behavior", () => {
  const cases = fixture("ledger-upgrades.json") as { name: string; input: any; expected: any }[];
  assert.deepEqual(cases.map((item) => item.input.version), [1, 2, 3, 4]);
  for (const item of cases) {
    const parsed = ledgerWriteSchema.safeParse({ revision: 0, ledger: item.input });
    assert.equal(parsed.success, true, item.name);
    if (parsed.success) assert.deepEqual(parsed.data.ledger, item.expected, item.name);
    assert.deepEqual(upgradeLedger(item.input), item.expected, item.name);
  }
});

test("language-neutral money, calendar and split fixtures match current rules", () => {
  const cases = fixture("parity-cases.json");
  for (const item of cases.money) {
    if (item.error) assert.throws(() => cents(item.input), { message: item.error });
    else assert.equal(cents(item.input), item.cents);
  }
  for (const item of cases.personalShares) {
    if (item.error) assert.throws(() => personalShare(item.total, item.mode, item.input), { message: item.error });
    else assert.equal(personalShare(item.total, item.mode, item.input), item.share);
  }
  for (const item of cases.dates)
    assert.equal(nextOccurrence(item.date, item.frequency, item.anchorDay), item.next);
  for (const item of cases.sharedSplits)
    assert.deepEqual(calculateHouseholdSplits(item.totalCents, item.input), item.expected);

});

test("sanitized HTTP journey matches the real legacy API and temporary SQLite", async () => {
  const expected = fixture("http-journey.json");
  const directory = mkdtempSync(join(tmpdir(), "penny-contract-"));
  const { app, db } = createApp({ databasePath: join(directory, "contract.sqlite") });
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api`;
    const call = (path: string, method = "GET", body?: unknown, token?: string) =>
      fetch(base + path, {
        method,
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const register = await call("/auth/register", "POST", expected.register.request);
    assert.equal(register.status, expected.register.status);
    const info = await (await call("/info")).json();
    assert.ok(matchesSchema(spec.components.schemas.ServerInfo, info));
    const session = await register.json();
    assert.equal(session.email, expected.register.response.email);
    assert.match(session.token, /^[a-f0-9]{64}$/);
    const cookie = register.headers.get("set-cookie") ?? "";
    assert.match(cookie, /penny_session=/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.match(cookie, /Path=\/api/i);

    const initial = await call("/ledger", "GET", undefined, session.token);
    assert.equal(initial.status, expected.initialLedger.status);
    const snapshot = await initial.json();
    assert.ok(matchesSchema(spec.components.schemas.Snapshot, snapshot), "initial ledger matches OpenAPI");
    assert.deepEqual({
      revision: snapshot.revision,
      ledgerVersion: snapshot.ledger.version,
      currency: snapshot.ledger.currency,
    }, expected.initialLedger.response);
    const updated = structuredClone(snapshot);
    updated.ledger.transactions.push(expected.write.request.entry);
    const write = await call("/ledger", "PUT", updated, session.token);
    assert.equal(write.status, expected.write.status);
    const saved = await write.json();
    assert.ok(matchesSchema(spec.components.schemas.Snapshot, saved), "saved ledger matches OpenAPI");
    assert.equal(saved.revision, expected.write.response.revision);
    assert.deepEqual(saved.ledger.transactions[0], expected.write.response.entry);

    const stale = await call("/ledger", "PUT", updated, session.token);
    assert.equal(stale.status, expected.staleWrite.status);
    const staleBody = await stale.json();
    assert.ok(matchesSchema(spec.components.schemas.Error, staleBody));
    assert.deepEqual(staleBody, expected.staleWrite.response);
    const projection = await call("/households/projection?month=2026-10", "GET", undefined, session.token);
    assert.equal(projection.status, expected.projection.status);
    const emptyProjection = await projection.json();
    assert.deepEqual(emptyProjection, expected.projection.response);
    assert.ok(matchesSchema(spec.paths["/api/households/projection"].get.responses[200].content["application/json"].schema, emptyProjection));

    const peer = await call("/auth/register", "POST", expected.shared.secondAccount);
    assert.equal(peer.status, 201);
    const peerSession = await peer.json();
    const householdResponse = await call("/households", "POST", expected.shared.household, session.token);
    assert.equal(householdResponse.status, 201);
    const householdId = (await householdResponse.json()).household.id;
    const inviteResponse = await call(`/households/${householdId}/invites`, "POST", undefined, session.token);
    assert.equal(inviteResponse.status, 201);
    const { code } = await inviteResponse.json();
    const joined = await call("/households/join", "POST", { code, timezoneOffsetMinutes: 0 }, peerSession.token);
    assert.equal(joined.status, 200);
    const sharedInput = { ...expected.shared.expense, payerUserId: (await (await call(`/households/${householdId}`, "GET", undefined, session.token)).json()).household.creatorId };
    const created = await call(`/households/${householdId}/expenses`, "POST", sharedInput, session.token);
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    assert.ok(matchesSchema(spec.paths["/api/households/{id}/expenses"].post.responses[201].content["application/json"].schema, createdBody));
    assert.ok(matchesSchema(spec.paths["/api/households"].post.responses[201].content["application/json"].schema, { household: (await (await call(`/households/${householdId}`, "GET", undefined, session.token)).json()).household }));
    const shared = createdBody.expense;
    assert.ok(matchesSchema(spec.components.schemas.Expense, shared), "shared expense matches OpenAPI");
    assert.equal(shared.revision, 0);
    const sharedProjection = await call("/households/projection?month=2099-01", "GET", undefined, peerSession.token);
    assert.equal(sharedProjection.status, 200);
    const projected = (await sharedProjection.json()).transactions[0];
    assert.ok(matchesSchema(spec.components.schemas.ProjectedExpense, projected), "projection matches OpenAPI");
    for (const [key, value] of Object.entries(expected.shared.projection))
      assert.equal(projected[key], value, `shared projection ${key}`);
    assert.equal(projected.accountId, undefined, "another member cannot see the payer's private account");
    const edited = await call(`/households/${householdId}/expenses/${shared.id}`, "PUT", { ...sharedInput, revision: 0 }, session.token);
    assert.equal(edited.status, 200);
    assert.equal((await edited.json()).expense.revision, 1);
    const staleShared = await call(`/households/${householdId}/expenses/${shared.id}`, "PUT", { ...sharedInput, revision: 0 }, session.token);
    assert.equal(staleShared.status, 409);
    assert.deepEqual(Object.keys(await staleShared.json()), ["error"]);
    const detail = await (await call(`/households/${householdId}`, "GET", undefined, peerSession.token)).json();
    const peerId = detail.members.find((member: { email: string }) => member.email === expected.shared.secondAccount.email).userId;
    const paid = await call(`/households/${householdId}/expenses/${shared.id}/payments`, "POST", { fromUserId: peerId, revision: 1 }, peerSession.token);
    assert.equal(paid.status, 201);
    assert.ok(matchesSchema(spec.paths["/api/households/{id}/expenses/{expenseId}/payments"].post.responses[201].content["application/json"].schema, await paid.json()));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
