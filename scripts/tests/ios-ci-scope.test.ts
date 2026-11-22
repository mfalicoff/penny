// Which macOS jobs of ios.yml a change runs (scripts/ios-ci-scope.mjs, MAZ-201).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { iosJobs } from "../../scripts/ios-ci-scope.mjs";

const pr = (files: string[], headRef = "mfalicoff2001/maz-1-change") => iosJobs({ event: "pull_request", headRef, files });

test("app, contract and workflow changes run every job", () => {
  for (const file of [
    "apps/ios/Penny/App.swift",
    "apps/ios/Configuration/Version.xcconfig",
    "contracts/design-baseline.json",
    "contracts/fixtures/redesign-states.json",
    "contracts/openapi.json",
    "contracts/swift/Sources/PennyContracts/Fixtures.swift",
    "docs/ios/ipa.md",
    ".github/workflows/ios-testflight.yml",
    ".github/workflows/ios.yml",
    "scripts/ios-ci-scope.mjs",
  ]) {
    assert.deepEqual(pr(["apps/web/src/app.tsx", file]), { app: true, stack: true }, file);
  }
});

test("backend, test environment and flake changes run only the full-stack smoke job", () => {
  for (const file of [
    "apps/backend/src/Penny.Api/Program.cs",
    "apps/backend/Directory.Packages.props",
    "apps/backend/global.json",
    "scripts/test-env/penny-env.mjs",
    "flake.nix",
    "flake.lock",
  ]) {
    assert.deepEqual(pr([file]), { app: false, stack: true }, file);
  }
});

test("web, site, docs, backend tests and contract notes run nothing on macOS", () => {
  assert.deepEqual(
    pr([
      "apps/web/src/app.tsx",
      "apps/site/index.html",
      "docs/design/penny-ios/iphone/home.html",
      "apps/backend/tests/Penny.Api.Tests/EntriesTests.cs",
      "apps/backend/README.md",
      "contracts/README.md",
      "contracts/visual-comparisons.json",
      ".github/workflows/web.yml",
    ]),
    { app: false, stack: false },
  );
  assert.deepEqual(pr([]), { app: false, stack: false });
});

test("Renovate's backend updates skip the smoke job; its flake and app updates don't", () => {
  const renovate = "renovate/backend-(non-major)";
  assert.deepEqual(pr(["apps/backend/Directory.Packages.props", "apps/backend/src/Penny.Api/packages.lock.json"], renovate), {
    app: false,
    stack: false,
  });
  assert.deepEqual(pr(["flake.lock"], "renovate/lock-file-maintenance"), { app: false, stack: true });
  assert.deepEqual(pr([".github/workflows/ios.yml"], "renovate/github-actions-(non-major)"), { app: true, stack: true });
});

test("Release Please's branch runs nothing; the TestFlight workflow runs the gates before archiving", () => {
  assert.deepEqual(
    pr(["apps/ios/Configuration/Version.xcconfig", "CHANGELOG.md", ".release-please-manifest.json"], "release-please--branches--master"),
    { app: false, stack: false },
  );
});

test("called, dispatched and pushed runs", () => {
  assert.deepEqual(iosJobs({ event: "release" }), { app: true, stack: true });
  assert.deepEqual(iosJobs({ event: "workflow_dispatch" }), { app: true, stack: true });
  assert.deepEqual(iosJobs({ event: "push" }), { app: false, stack: false });
});

// GitHub's path globs: `**` crosses folders (`**/` also matches no folder), `*` doesn't.
function globToRegExp(glob: string) {
  const part = (text: string) =>
    [...text].map((char) => (char === "*" ? "[^/]*" : /[.+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char)).join("");
  const any = (text: string) => text.split("**").map(part).join(".*");
  return new RegExp(`^${glob.split("**/").map(any).join("(?:.*/)?")}$`);
}

test("the workflow's pull request paths start a run for every change the jobs need", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/ios.yml", import.meta.url), "utf8");
  const block = /pull_request:\n\s+paths:\n((?:\s+- .+\n)+)/.exec(workflow)?.[1] ?? "";
  const patterns = [...block.matchAll(/- '?([^'\n]+)'?/g)].map((match) => match[1].trim());
  assert.ok(patterns.length > 0, "ios.yml lists pull request paths");
  // GitHub applies the patterns in order: a later `!` pattern excludes, a later plain one includes.
  const starts = (file: string) =>
    patterns.reduce(
      (included, pattern) =>
        pattern.startsWith("!") ? included && !globToRegExp(pattern.slice(1)).test(file) : included || globToRegExp(pattern).test(file),
      false,
    );
  for (const file of [
    "apps/ios/Penny/App.swift",
    "contracts/design-baseline.json",
    "contracts/swift/Package.swift",
    "docs/ios/ipa.md",
    ".github/workflows/ios-testflight.yml",
    ".github/workflows/ios.yml",
    "scripts/ios-ci-scope.mjs",
    "apps/backend/src/Penny.Api/Program.cs",
    "apps/backend/Directory.Packages.props",
    "scripts/test-env/penny-env.mjs",
    "flake.nix",
    "flake.lock",
  ]) {
    assert.ok(starts(file), `${file} starts ios.yml`);
  }
  for (const file of [
    "apps/web/src/app.tsx",
    "contracts/README.md",
    "contracts/visual-comparisons.json",
    "apps/backend/tests/Penny.Api.Tests/EntriesTests.cs",
    "apps/backend/README.md",
  ]) {
    assert.ok(!starts(file), `${file} doesn't start ios.yml`);
  }
});
