// PR titles become the squash commit Release Please reads (scripts/pr-title.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPrTitle } from "../../scripts/pr-title.mjs";

test("Conventional Commit titles pass, with or without a scope and breaking marker", () => {
  for (const title of [
    "fix(deps): update all dependencies",
    "feat: emailed receipts (MAZ-184)",
    "feat(apphost): run emailed receipts locally under Aspire (MAZ-184)",
    "refactor!: Version 2 change bump",
    "chore(master): release 2.0.0",
    "test(backend): say why MailConverter tests fail without pdfinfo or libvips",
    "ci: fail when the release version and the Release Please manifest disagree",
  ]) {
    assert.equal(checkPrTitle(title), null, title);
  }
});

test("other titles fail with the expected format", () => {
  for (const title of [
    "Update all dependencies",
    "Fix: totals",
    "fix:totals",
    "fix(): totals",
    "feature: totals",
    "fix totals",
    "",
    "   ",
  ]) {
    assert.notEqual(checkPrTitle(title), null, JSON.stringify(title));
  }
  assert.match(checkPrTitle("Update all dependencies") ?? "", /fix\(deps\): update all dependencies/);
});
