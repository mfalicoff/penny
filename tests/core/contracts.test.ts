import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { cents, emptyLedger, nextOccurrence, personalShare } from "../../src/domain/ledger.ts";
import { calculateHouseholdSplits } from "../../src/domain/households.ts";
import { ledgerWriteSchema } from "../../src/validation/ledger.ts";
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

test("OpenAPI operations are unique, documented and resolve every schema", () => {
  assert.equal(spec.openapi, "3.1.0");
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

test("search fixtures cover substring matching, chronology and pending local scope", () => {
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
  }

  for (const source of baseline.sources) assert.equal(source.sha256, hash(source.path), `${source.path} changed: re-sync the baseline`);
  assert.deepEqual(baseline.appearances, ["light", "dark"]);
  assert.deepEqual(Object.keys(baseline.tokens.palettes), baseline.appearances);
  assert.deepEqual(Object.keys(baseline.tokens.palettes.dark), Object.keys(baseline.tokens.palettes.light));
  assert.equal(baseline.tokens.fonts.web.family, "Inter");
  assert.equal(baseline.tokens.icons.ios.family, "SF Symbols");

  // Every route (web URL and iOS deep link) has a destination on each platform.
  assert.equal(baseline.navigation.routes.length, 12);
  assert.equal(new Set(baseline.navigation.routes.map((item: any) => item.route)).size, 12);
  for (const item of baseline.navigation.routes) for (const platform of ["iPhone", "iPad", "web"]) assert.ok(item[platform], `${item.route} on ${platform}`);
  for (const item of baseline.specimens) if (item.route) assert.ok(baseline.navigation.routes.some((route: any) => route.route === item.route), item.route);

  // New behavior the design implies is filed, and the cards point back at it.
  const ids = new Set(baseline.specimens.map((item: any) => item.id));
  for (const behavior of baseline.behaviorIssues) for (const id of behavior.specimens) {
    assert.ok(ids.has(id), id);
    assert.ok(baseline.specimens.find((item: any) => item.id === id).behaviorIssues.includes(behavior.issue), `${id} lists ${behavior.issue}`);
  }
  for (const item of baseline.specimens) for (const issue of item.behaviorIssues ?? [])
    assert.ok(baseline.behaviorIssues.some((behavior: any) => behavior.issue === issue && behavior.specimens.includes(item.id)));
});

test("visual baselines match their cards, and the comparison record covers every card on each platform (MAZ-122)", () => {
  const baseline = JSON.parse(readFileSync(new URL("contracts/design-baseline.json", root), "utf8"));
  const states = fixture("redesign-states.json").states;
  const file = (path: string) => readFileSync(new URL(path, root));
  const hash = (path: string) => createHash("sha256").update(file(path)).digest("hex");
  const ids = baseline.specimens.map((item: any) => item.id);

  // Baselines: one PNG per card and appearance, rendered from the card and assets on disk.
  const manifest = JSON.parse(file("docs/design/penny-ios/previews/manifest.json").toString("utf8"));
  assert.equal(baseline.design.baselines, "docs/design/penny-ios/previews/manifest.json");
  assert.equal(manifest.scale, 2);
  assert.deepEqual(manifest.cards.map((card: any) => card.id).sort(), [...ids].sort());
  const assets = readdirSync(new URL("docs/design/penny-ios/assets/", root)).sort();
  assert.deepEqual(manifest.assets.map((asset: any) => asset.path), assets.map((name) => `assets/${name}`));
  for (const asset of manifest.assets)
    assert.equal(asset.sha256, hash(`docs/design/penny-ios/${asset.path}`), `${asset.path} changed: run node docs/design/penny-ios/render.mjs 2`);
  const pngs = new Set(readdirSync(new URL("docs/design/penny-ios/previews/", root)).filter((name) => name.endsWith(".png")));
  for (const card of manifest.cards) {
    const specimen = baseline.specimens.find((item: any) => item.id === card.id);
    assert.equal(card.source, specimen.sourcePath);
    assert.deepEqual(card.viewport, specimen.viewport);
    assert.equal(card.sourceSha256, specimen.sha256, `${card.id} changed since its baselines: run node docs/design/penny-ios/render.mjs 2`);
    const state = states.find((item: any) => item.specimen === card.id);
    assert.deepEqual(card.images.map((image: any) => image.appearance), state.appearances, `${card.id}: one baseline per appearance`);
    for (const image of card.images) {
      assert.equal(image.file, `previews/${card.id}.${image.appearance}.png`);
      assert.ok(pngs.delete(`${card.id}.${image.appearance}.png`), `${image.file} is missing`);
      assert.equal(image.sha256, hash(`docs/design/penny-ios/${image.file}`), `${image.file} doesn't match the manifest`);
    }
  }
  assert.deepEqual([...pngs], [], "previews/ holds only the baselines");

  // The record: every card on both platforms, with a status the evidence supports.
  const record = JSON.parse(file("contracts/visual-comparisons.json").toString("utf8"));
  assert.equal(baseline.design.comparisons, "contracts/visual-comparisons.json");
  assert.equal(record.version, 1);
  assert.match(record.reviewedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(record.cards.map((card: any) => card.id), ids, "one entry per card, in contract order");
  const slug = (heading: string) => heading.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s/g, "-");
  const anchors = new Set(file("docs/reference/redesign.md").toString("utf8").split("\n")
    .filter((line) => line.startsWith("#")).map((line) => slug(line.replace(/^#+\s*/, ""))));
  const statuses = ["matches", "deviates", "not-built", "blocked", "not-applicable"];
  for (const card of record.cards) {
    const specimen = baseline.specimens.find((item: any) => item.id === card.id);
    const state = states.find((item: any) => item.specimen === card.id);
    assert.equal(card.view, state.view, `${card.id}: the view is the redesign state's`);
    for (const side of ["native", "web"] as const) {
      const entry = card[side];
      const where = `${card.id} (${side})`;
      assert.ok(statuses.includes(entry.status), `${where}: ${String(entry.status)} is not reviewed`);
      assert.equal(entry.owner, specimen[`${side}Issue`], `${where}: owner is the contract's feature issue`);
      if (entry.status === "not-applicable" || entry.status === "blocked") assert.ok(entry.note?.length > 10, `${where}: say why`);
      if (specimen[`${side}Issue`] === null) assert.equal(entry.status, "not-applicable", where);
      if (state.blockedBy) assert.equal(entry.status === "not-applicable" ? "blocked" : entry.status, "blocked", `${where}: ${state.blockedBy}`);
      if (entry.status === "not-built") {
        assert.ok(entry.note?.length > 10, `${where}: say what is missing`);
        assert.match(entry.followUp, /^MAZ-\d+$/, `${where}: name the issue that builds it`);
      }
      if (entry.status === "matches" || entry.status === "deviates") {
        assert.match(entry.capture, side === "native" ? /^(iPhone|iPad) / : /^\d+x\d+$/, `${where}: name the device or viewport compared`);
        assert.deepEqual(entry.appearances, state.appearances, `${where}: compared in every appearance`);
      }
      assert.equal((entry.deviations ?? []).length > 0, entry.status === "deviates", `${where}: deviations iff deviates`);
      for (const deviation of entry.deviations ?? []) {
        assert.ok(deviation.summary.length > 10, where);
        assert.ok(["approved", "follow-up"].includes(deviation.kind), where);
        if (deviation.kind === "approved") {
          const [path, anchor] = deviation.ref.split("#");
          assert.equal(path, "docs/reference/redesign.md", `${where}: approved deviations are recorded in redesign.md`);
          assert.ok(anchors.has(anchor), `${where}: redesign.md has no #${anchor as string}`);
        } else assert.match(deviation.ref, /^MAZ-\d+$/, `${where}: a follow-up names its issue`);
      }
    }
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

test("the sanitized HTTP journey fixture matches OpenAPI and the ledger rules (the .NET LedgerTests replay it)", () => {
  const expected = fixture("http-journey.json");
  const schema = (path: string, method: string, status: number) => spec.paths[path][method].responses[status].content["application/json"].schema;
  assert.ok(matchesSchema(spec.components.schemas.Credentials, expected.register.request));
  assert.ok(matchesSchema(spec.components.schemas.Credentials, expected.shared.secondAccount));
  const initial = { revision: expected.initialLedger.response.revision, ledger: emptyLedger() };
  assert.equal(initial.ledger.version, expected.initialLedger.response.ledgerVersion);
  assert.equal(initial.ledger.currency, expected.initialLedger.response.currency);
  assert.ok(matchesSchema(spec.components.schemas.Snapshot, initial), "initial ledger matches OpenAPI");
  const written = { revision: expected.write.response.revision, ledger: { ...initial.ledger, transactions: [expected.write.request.entry] } };
  assert.ok(matchesSchema(spec.components.schemas.Snapshot, written), "saved ledger matches OpenAPI");
  assert.equal(ledgerWriteSchema.safeParse(written).success, true);
  assert.deepEqual(expected.write.response.entry, expected.write.request.entry);
  assert.equal(expected.staleWrite.status, 409);
  assert.ok(matchesSchema(spec.components.schemas.Error, expected.staleWrite.response));
  assert.ok(matchesSchema(schema("/api/households/projection", "get", 200), expected.projection.response));
  assert.ok(matchesSchema(spec.components.schemas.HouseholdInput, expected.shared.household));
  assert.ok(matchesSchema(spec.components.schemas.ExpenseInput, { ...expected.shared.expense, payerUserId: "0".repeat(32) }));
  assert.equal(expected.shared.projection.shareCents * 2, expected.shared.projection.totalCents, "an equal split between two members");
});
