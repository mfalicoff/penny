// MAZ-64 parity gate: every operation the legacy server implements must either be
// compared legacy-versus-.NET by the `differential` scenario (scripts/test-env/compare.mjs)
// or be listed here with the reason it cannot be and the suites that cover it instead.
// Adding a legacy route without doing one or the other fails this test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8"));

// Operation → why the shared fixture cannot probe it, and where it is verified.
// The fixture refuses "password", "token" and "code" keys so it can never carry
// secrets (tests/core/golden-fixtures.test.ts), which rules out sign-in bodies,
// device tokens and invite codes as probe bodies.
export const uncompared: Record<string, { reason: string; evidence: string[] }> = {
  "GET /api/auth/oidc": {
    reason: "Needs an identity provider; the legacy comparison server runs with OIDC disabled.",
    evidence: [
      "tests/core/oidc.test.ts",
      "apps/backend/tests/Penny.Backend.IntegrationTests/Controllers/OidcTests.cs",
      "tests/fullstack/environment.test.mjs",
    ],
  },
  "POST /api/auth/oidc/start": {
    reason: "Needs an identity provider; responses carry provider-specific URLs and PKCE values.",
    evidence: [
      "tests/core/oidc.test.ts",
      "apps/backend/tests/Penny.Backend.IntegrationTests/Controllers/OidcTests.cs",
      "apps/backend/tests/Penny.Backend.IntegrationTests/Http/UserJourneyTests.cs",
    ],
  },
  "POST /api/auth/oidc/complete": {
    reason: "Needs an identity provider and a signed ID token.",
    evidence: [
      "tests/core/oidc.test.ts",
      "apps/backend/tests/Penny.Backend.IntegrationTests/Controllers/OidcTests.cs",
      "apps/backend/tests/Penny.Backend.IntegrationTests/Http/UserJourneyTests.cs",
    ],
  },
  "POST /api/auth/login": {
    reason: "The body needs a password; the seeder logs in on both servers for every scenario user.",
    evidence: [
      "scripts/test-env/seed.mjs",
      "tests/core/server-boundaries.test.ts",
      "apps/backend/tests/Penny.Backend.IntegrationTests/Controllers/AuthTests.cs",
    ],
  },
  "POST /api/push/devices": {
    reason: "The body needs a device token.",
    evidence: [
      "apps/backend/tests/Penny.Backend.IntegrationTests/Controllers/PushDeviceTests.cs",
      "apps/backend/tests/Penny.Backend.IntegrationTests/Migrations/ImportedPushTests.cs",
    ],
  },
  "DELETE /api/push/devices": {
    reason: "The body needs a device token.",
    evidence: ["apps/backend/tests/Penny.Backend.IntegrationTests/Controllers/PushDeviceTests.cs"],
  },
  "POST /api/households/join": {
    reason: "The body needs an invite code; seed steps join on both servers and later probes compare the result.",
    evidence: [
      "scripts/test-env/seed.mjs",
      "apps/backend/tests/Penny.Backend.IntegrationTests/Controllers/HouseholdMembershipTests.cs",
    ],
  },
};

type Operation = { method: string; path: string; implementation: string };

function operations(): Operation[] {
  const spec = json("contracts/openapi.json");
  return Object.entries(spec.paths as Record<string, Record<string, any>>).flatMap(([path, item]) =>
    Object.entries(item)
      .filter(([, operation]) => operation && typeof operation === "object" && operation.responses)
      .map(([method, operation]) => ({ method: method.toUpperCase(), path, implementation: operation["x-implementation"] })),
  );
}

// Probe paths use "$household:x" style references and query strings.
function probedOperations(): Set<string> {
  const scenario = json("contracts/fixtures/full-stack-seeds.json").scenarios.find((item: any) => item.name === "differential");
  const all = operations();
  const found = new Set<string>();
  for (const probe of scenario.probes) {
    const path = probe.path.replace(/\$(user|household|expense|rule|email):[a-z0-9-]+/g, "ref").replace("$month", "2026-01");
    for (const operation of all) {
      const pattern = new RegExp(`^${operation.path.replace(/\{[^}]+\}/g, "[^/?]+")}(\\?.*)?$`);
      if (operation.method === probe.method && pattern.test(path)) found.add(`${operation.method} ${operation.path}`);
    }
  }
  return found;
}

test("every legacy operation is compared with .NET or registered with a reason and evidence", () => {
  const legacy = operations().filter((operation) => operation.implementation === "legacy");
  assert.ok(legacy.length >= 40, "the contract still marks the legacy operations");
  const probed = probedOperations();
  const missing = legacy
    .map((operation) => `${operation.method} ${operation.path}`)
    .filter((key) => !probed.has(key) && !(key in uncompared));
  assert.deepEqual(missing, [], "add a differential probe or an `uncompared` entry");
  for (const [key, entry] of Object.entries(uncompared)) {
    assert.ok(!probed.has(key), `${key} is probed now; remove its uncompared entry`);
    assert.ok(legacy.some((operation) => `${operation.method} ${operation.path}` === key), `${key} is a legacy operation`);
    assert.ok(entry.reason.length > 10);
    for (const file of entry.evidence) assert.ok(existsSync(new URL(file, root)), `${key}: ${file} exists`);
  }
});

test("every registered difference names a probe and the documented reason", () => {
  const scenario = json("contracts/fixtures/full-stack-seeds.json").scenarios.find((item: any) => item.name === "differential");
  const names = new Set(scenario.probes.map((probe: { name: string }) => probe.name));
  assert.equal(names.size, scenario.probes.length, "probe names are unique");
  for (const difference of scenario.knownDifferences ?? []) {
    assert.ok(names.has(difference.probe), `${difference.probe} is a probe`);
    const [document] = /docs\/migration\/[a-z-]+\.md/.exec(difference.reason) ?? [];
    assert.ok(document, `${difference.probe}: the reason links the document that records it`);
    assert.ok(existsSync(new URL(document, root)), `${document} exists`);
  }
});
