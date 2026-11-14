// MAZ-82: keeps the native QA matrix (docs/ios-qa.md) honest. Every redesign card whose native
// acceptance is MAZ-82 must have a row in the card trace, and every XCUITest suite or test the
// document names must exist in apps/ios/PennyUITests, so the matrix cannot cite coverage that
// was renamed or never written.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const doc = readFileSync(join(root, "docs/ios-qa.md"), "utf8");
const baseline = JSON.parse(readFileSync(join(root, "contracts/design-baseline.json"), "utf8")) as {
  specimens: { id: string; acceptance: { native: string | null } }[];
};

function swiftFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return swiftFiles(path);
    return entry.name.endsWith(".swift") ? [path] : [];
  });
}

const uiTestSources = swiftFiles(join(root, "apps/ios/PennyUITests")).map((path) => readFileSync(path, "utf8"));
const suites = new Set(uiTestSources.flatMap((text) => [...text.matchAll(/final class (\w+Tests)\b/g)].map((m) => m[1])));
const tests = new Set(uiTestSources.flatMap((text) => [...text.matchAll(/func (test_\w+)\(/g)].map((m) => m[1])));

test("every card with MAZ-82 native acceptance has a row in the native card trace", () => {
  const cards = baseline.specimens.filter((card) => card.acceptance.native === "MAZ-82").map((card) => card.id);
  assert.ok(cards.length > 0);
  const missing = cards.filter((id) => !doc.includes(`| \`${id}\` |`));
  assert.deepEqual(missing, [], `cards without a row in docs/ios-qa.md: ${missing.join(", ")}`);
});

test("every XCUITest suite the native QA matrix names exists", () => {
  const named = new Set([...doc.matchAll(/`(\w+Tests)`/g)].map((m) => m[1]));
  assert.ok(named.size > 0);
  const unknown = [...named].filter((name) => !suites.has(name));
  assert.deepEqual(unknown, [], `suites named in docs/ios-qa.md but not in PennyUITests: ${unknown.join(", ")}`);
});

test("every XCUITest method the native QA matrix names exists", () => {
  const named = new Set([...doc.matchAll(/`(test_\w+)`/g)].map((m) => m[1]));
  const unknown = [...named].filter((name) => !tests.has(name));
  assert.deepEqual(unknown, [], `tests named in docs/ios-qa.md but not in PennyUITests: ${unknown.join(", ")}`);
});
