// MAZ-62 runner logic that needs no containers: run ids, the pinned image, the native
// PostgreSQL mode selection, seed references and the provider's generated certificate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { databaseName, nativePostgresBin, newRunId, postgresImage, postgresMode, runnerEnvironment, validRunId, webOrigins } from "../../scripts/test-env/environment.mjs";
import { applyPendingEdits, resolve } from "../../scripts/test-env/seed.mjs";
import { redirectUrisFor, selfSignedCertificate } from "../../scripts/test-env/oidc-provider.mjs";
import { integer, trustCertificate, writeCertificate } from "../../scripts/test-env/tls.mjs";

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

test("PENNY_POSTGRES picks the container by default and native only when asked", () => {
  assert.equal(postgresMode({}), "container");
  assert.equal(postgresMode({ PENNY_POSTGRES: "" }), "container");
  assert.equal(postgresMode({ PENNY_POSTGRES: "native" }), "native");
  assert.throws(() => postgresMode({ PENNY_POSTGRES: "external" }), /container" or "native/);
});

test("native mode requires PostgreSQL 18 binaries before creating a cluster", () => {
  const directory = mkdtempSync(join(tmpdir(), "penny-pg-bin-"));
  try {
    assert.throws(() => nativePostgresBin({ PENNY_POSTGRES_BIN: directory }), /initdb is missing/);
    const tool = (name: string, output: string) => {
      writeFileSync(join(directory, name), `#!/bin/sh\necho "${output}"\n`);
      chmodSync(join(directory, name), 0o755);
    };
    tool("pg_ctl", "");
    tool("psql", "");
    tool("initdb", "initdb (PostgreSQL) 17.4");
    assert.throws(() => nativePostgresBin({ PENNY_POSTGRES_BIN: directory }), /PostgreSQL 18 is required/);
    tool("initdb", "initdb (PostgreSQL) 17.18"); // a minor version 18 is not major 18
    assert.throws(() => nativePostgresBin({ PENNY_POSTGRES_BIN: directory }), /PostgreSQL 18 is required/);
    tool("initdb", "initdb (PostgreSQL) 18.6");
    assert.equal(nativePostgresBin({ PENNY_POSTGRES_BIN: directory }), directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runner environment exposes the API and control token, never database credentials", () => {
  const value = runnerEnvironment({ runId: "r1", apiUrl: "http://127.0.0.1:1", controlToken: "t" });
  assert.deepEqual(Object.keys(value).sort(), ["PENNY_API_URL", "PENNY_TEST_RUN", "PENNY_TEST_TOKEN"]);
  const oidc = runnerEnvironment({
    runId: "r1", apiUrl: "http://127.0.0.1:1", controlToken: "t",
    oidc: { issuer: "https://127.0.0.1:2", clientId: "penny-test", certificate: "/tmp/certificate.pem" },
  });
  assert.equal(oidc.PENNY_OIDC_ISSUER, "https://127.0.0.1:2");
  assert.equal(oidc.PENNY_OIDC_CERTIFICATE, "/tmp/certificate.pem");
  // A run's web port and certificate reach the runner: vite serves on the port it allows, Node
  // trusts the HTTPS API through NODE_EXTRA_CA_CERTS and simulators through PENNY_API_CERTIFICATE.
  const run = runnerEnvironment({
    runId: "r1", apiUrl: "https://127.0.0.1:1", controlToken: "t", webPort: 41234,
    tls: { certificate: "/run/certificate.pem", key: "/run/key.pem", trustBundle: "/run/trust.pem" },
  });
  assert.equal(run.PENNY_WEB_PORT, "41234");
  assert.equal(run.PENNY_API_CERTIFICATE, "/run/certificate.pem");
  assert.equal(run.NODE_EXTRA_CA_CERTS, "/run/trust.pem");
  assert.ok(!Object.values(run).includes("/run/key.pem"), "the private key never leaves the run");
});

test("each run gets its own id, and allows its own web port next to the dev server's", () => {
  const ids = new Set(Array.from({ length: 50 }, () => newRunId()));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.ok(validRunId(id));
  assert.deepEqual(webOrigins([41234]), [
    "http://localhost:4173", "http://127.0.0.1:4173", "http://localhost:41234", "http://127.0.0.1:41234",
  ]);
  assert.deepEqual(webOrigins([4173]), ["http://localhost:4173", "http://127.0.0.1:4173"]);
  assert.deepEqual(redirectUrisFor([41234]), [
    "http://localhost:4173/auth/callback", "http://127.0.0.1:4173/auth/callback",
    "http://localhost:41234/auth/callback", "http://127.0.0.1:41234/auth/callback",
    "penny://auth/callback",
  ]);
});

test("a run's certificate is private to it, and trusting it lets fetch reach an HTTPS server", async () => {
  const directory = mkdtempSync(join(tmpdir(), "penny-tls-"));
  try {
    const other = writeCertificate(join(directory, "other", "tls"));
    trustCertificate(other.pem); // Trusting another run first must not hide this one.
    const tls = writeCertificate(join(directory, "run", "tls"));
    assert.equal(statSync(tls.keyPath).mode & 0o777, 0o600);
    assert.equal(statSync(join(directory, "run", "tls")).mode & 0o777, 0o700);
    assert.ok(readFileSync(tls.trustBundle, "utf8").startsWith(tls.pem));
    const server = createServer({ cert: tls.pem, key: tls.key }, (_request, response) => response.end("ok"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const url = `https://127.0.0.1:${(server.address() as AddressInfo).port}/`;
      await assert.rejects(fetch(url), "an untrusted certificate is refused");
      trustCertificate(tls.pem);
      assert.equal(await (await fetch(url)).text(), "ok");
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("seed references resolve whole values and embedded paths", () => {
  const context = { userIds: { alex: "u1" }, households: { home: "h1" }, expenseIds: { lunch: "e1" } };
  assert.deepEqual(resolve({ payer: "$user:alex", list: ["$household:home"] }, context), { payer: "u1", list: ["h1"] });
  assert.equal(resolve("/api/households/$household:home/expenses/$expense:lunch", context), "/api/households/h1/expenses/e1");
  assert.throws(() => resolve("$user:bea", context), /not defined/);
});

test("pending edits apply delete, edit and create to a copy", () => {
  const ledger = { transactions: [{ id: "a", title: "A" }, { id: "b", title: "B" }] };
  const local = applyPendingEdits(ledger, { delete: ["a"], edit: [{ id: "b", patch: { title: "B2" } }], create: [{ id: "c", title: "C" }] });
  assert.deepEqual(local.transactions, [{ id: "b", title: "B2" }, { id: "c", title: "C" }]);
  assert.equal(ledger.transactions.length, 2);
});

test("the run's certificate is a valid self-signed loopback server certificate", () => {
  const { pem } = selfSignedCertificate();
  const certificate = new X509Certificate(pem);
  assert.match(certificate.subject, /^CN=penny-test-[0-9a-f]{12}$/);
  assert.notEqual(new X509Certificate(selfSignedCertificate().pem).subject, certificate.subject, "each certificate has its own name");
  assert.deepEqual(certificate.keyUsage, ["1.3.6.1.5.5.7.3.1"], "server authentication, as Apple platforms require");
  assert.ok(certificate.checkIP("127.0.0.1"));
  assert.equal(certificate.checkHost("localhost"), "localhost");
  assert.ok(certificate.verify(certificate.publicKey));
  assert.ok(new Date(certificate.validTo).getTime() > Date.now());
});

test("certificate serials are minimal DER integers, whatever random bytes they start with", () => {
  const hex = (bytes: number[]) => integer(Buffer.from(bytes)).toString("hex");
  assert.equal(hex([0x00, 0x00, 0x12, 0x34]), "02021234");
  assert.equal(hex([0x00, 0x7f]), "02017f");
  assert.equal(hex([0x00, 0x80]), "02020080");
  assert.equal(hex([0x00, 0x00, 0x80]), "02020080");
  assert.equal(hex([0x80, 0x01]), "0203008001");
  assert.equal(hex([0x12]), "020112");
  assert.equal(hex([0x00]), "020100");
});
