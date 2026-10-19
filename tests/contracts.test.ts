import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createApp } from "../server/app.ts";
import { cents, emptyLedger, nextOccurrence, personalShare, upgradeLedger } from "../src/domain/ledger.ts";
import { calculateHouseholdSplits } from "../src/domain/households.ts";
import { mergeLedger } from "../src/data/offlineLedger.ts";
import { ledgerWriteSchema } from "../server/validation/ledger.ts";

const root = new URL("../", import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`contracts/fixtures/${name}`, root), "utf8"));
const spec = JSON.parse(readFileSync(new URL("contracts/openapi.json", root), "utf8"));

function matchesSchema(schema: any, value: unknown): boolean {
  if (schema.$ref) return matchesSchema(spec.components.schemas[schema.$ref.split("/").at(-1)], value);
  if (schema.const !== undefined && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.oneOf && schema.oneOf.filter((part: any) => matchesSchema(part, value)).length !== 1) return false;
  if (schema.allOf && schema.allOf.some((part: any) => !matchesSchema(part, value))) return false;
  if (schema.if && matchesSchema(schema.if, value) && schema.then && !matchesSchema(schema.then, value)) return false;
  if (schema.type === "object" || schema.properties || schema.required) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const object = value as Record<string, unknown>;
    if (schema.required?.some((key: string) => !(key in object))) return false;
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
  const actual = ["get /api/health"];
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
    Object.keys(operations as object).map((method) => `${method} ${path}`));
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

test("language-neutral money, calendar, split and conflict fixtures match current rules", () => {
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

  const base = emptyLedger();
  const original = { id: "synthetic-entry", title: "Sample", kind: "expense" as const,
    total: 1000, share: cases.merge.base.share, categoryId: "food", date: "2026-10-01", note: cases.merge.base.note };
  base.transactions = [original];
  const local = { ...base, transactions: [{ ...original, ...cases.merge.local }] };
  const remote = { ...base, transactions: [{ ...original, ...cases.merge.remote }] };
  const merged = mergeLedger(base, local, remote);
  assert.equal(merged.transactions[0].note, cases.merge.expected.note);
  assert.equal(merged.transactions[0].share, cases.merge.expected.share);
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
    assert.deepEqual(await projection.json(), expected.projection.response);

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
    const shared = (await created.json()).expense;
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
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
