// MAZ-62 runner logic that needs no containers: run ids, the pinned image, seed
// references, comparison normalization and the provider's generated certificate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { databaseName, postgresImage, runnerEnvironment, validRunId } from "../../scripts/test-env/environment.mjs";
import { applyPendingEdits, resolve } from "../../scripts/test-env/seed.mjs";
import { differences, normalize } from "../../scripts/test-env/compare.mjs";
import { selfSignedCertificate } from "../../scripts/test-env/oidc-provider.mjs";

test("run ids are restricted before they name containers and databases", () => {
  for (const id of ["r1a2b3c4d5", "ci42"]) assert.ok(validRunId(id));
  for (const id of ["", "abc", "UPPER", "a; drop", "penny_test", "x".repeat(25), "../etc"]) assert.equal(validRunId(id), false, id);
  assert.equal(databaseName("r1a2b3c4d5"), "penny_test_r1a2b3c4d5");
  assert.throws(() => databaseName("bad id"));
});

test("environments use the PostgreSQL image pinned in compose and DatabaseSchema", () => {
  const image = postgresImage();
  assert.match(image, /^docker\.io\/pgvector\/pgvector:[^@]+@sha256:[0-9a-f]{64}$/);
  const schema = readFileSync(new URL("../../apps/backend/src/Penny.Backend.Persistence/Schema/DatabaseSchema.cs", import.meta.url), "utf8");
  assert.ok(schema.includes(image.split("@")[1]), "the C# fixture pins the same digest");
});

test("runner environment exposes the API and control token, never database credentials", () => {
  const value = runnerEnvironment({ runId: "r1", apiUrl: "http://127.0.0.1:1", controlToken: "t" });
  assert.deepEqual(Object.keys(value).sort(), ["PENNY_API_URL", "PENNY_TEST_RUN", "PENNY_TEST_TOKEN"]);
});

test("seed references resolve whole values, embedded paths and dates", () => {
  const context = { today: "2026-11-09", userIds: { alex: "u1" }, households: { home: "h1" }, expenseIds: { lunch: "e1" } };
  assert.deepEqual(resolve({ payer: "$user:alex", list: ["$household:home"], date: "$today" }, context), { payer: "u1", list: ["h1"], date: "2026-11-09" });
  assert.equal(resolve("/api/households/$household:home/expenses/$expense:lunch?month=$month", context), "/api/households/h1/expenses/e1?month=2026-11");
  assert.throws(() => resolve("$user:bea", context), /not defined/);
});

test("pending edits apply delete, edit and create to a copy", () => {
  const ledger = { transactions: [{ id: "a", title: "A" }, { id: "b", title: "B" }] };
  const local = applyPendingEdits(ledger, { delete: ["a"], edit: [{ id: "b", patch: { title: "B2" } }], create: [{ id: "c", title: "C" }] });
  assert.deepEqual(local.transactions, [{ id: "b", title: "B2" }, { id: "c", title: "C" }]);
  assert.equal(ledger.transactions.length, 2);
});

test("comparison normalizes generated values but keeps real differences", () => {
  const context = {
    userIds: { alex: "a".repeat(32), bea: "b".repeat(32) }, households: { home: "c".repeat(32) }, expenseIds: {},
    users: { alex: { email: "alex.r1@penny.test", token: "d".repeat(64) }, bea: { email: "bea.r1@penny.test", token: "e".repeat(64) } },
  };
  const body = {
    household: { id: "c".repeat(32), createdAt: 1_789_000_000_000, code: "ABCDEF0123" },
    splits: [{ userId: "b".repeat(32), amountCents: 1 }, { userId: "a".repeat(32), amountCents: 2 }],
    ledger: { categories: [{ id: "z" }, { id: "a" }] },
    other: "f".repeat(32),
    email: "alex.r1@penny.test",
  };
  assert.deepEqual(normalize(body, context), {
    email: "<email:alex>",
    household: { code: "<invite-code>", createdAt: "<instant>", id: "<household:home>" },
    ledger: { categories: [{ id: "a" }, { id: "z" }] },
    other: "<generated-id>",
    splits: [{ amountCents: 2, userId: "<user:alex>" }, { amountCents: 1, userId: "<user:bea>" }],
  });
  assert.deepEqual(differences({ a: [1, 2], b: "x" }, { a: [1, 3], b: "x" }), [{ path: "/a/1", legacy: 2, dotnet: 3 }]);
  assert.deepEqual(differences({ status: 409 }, { status: 409 }), []);
});

test("the local OIDC provider's certificate is a valid self-signed loopback certificate", () => {
  const { pem } = selfSignedCertificate();
  const certificate = new X509Certificate(pem);
  assert.equal(certificate.subject, "CN=penny-test-oidc");
  assert.ok(certificate.checkIP("127.0.0.1"));
  assert.equal(certificate.checkHost("localhost"), "localhost");
  assert.ok(certificate.verify(certificate.publicKey));
  assert.ok(new Date(certificate.validTo).getTime() > Date.now());
});
