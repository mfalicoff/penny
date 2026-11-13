// Runs the real-server Playwright specs (e2e/*.real.spec.ts) against a disposable full-stack
// environment (MAZ-95): PostgreSQL 18 in a container, the migrated database, the .NET API built
// from this checkout and the local OIDC provider (docs/migration/test-environment.md). The
// environment is always torn down; its API and PostgreSQL logs are copied to
// ../../test-results/fullstack/<run id>/. Arguments are passed to `playwright test`:
//
//   npm run build && npm run test:e2e:real -- --project=firefox-desktop
//
// PENNY_E2E_BROWSERS and PENNY_E2E_DEVICES choose the projects (playwright.config.ts).
//
// With PENNY_E2E_REUSE_STACK=1 and an environment already up (PENNY_API_URL, PENNY_TEST_TOKEN and
// PENNY_TEST_RUN exported, e.g. from `npm run test-env -- env`), the specs run against that one
// and nothing is torn down, so an iOS Simulator run (`apps/ios/scripts/ios.sh ui-test`, which
// reuses the same variables) and the browser share one API and database (MAZ-96,
// docs/acceptance.md).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const app = fileURLToPath(new URL("..", import.meta.url));
const runner = fileURLToPath(new URL("../../../scripts/test-env/penny-env.mjs", import.meta.url));

if (!existsSync(`${app}/dist/index.html`)) {
  console.error("No production build in apps/web/dist: run `npm run build` first.");
  process.exit(1);
}

const reuse = process.env.PENNY_E2E_REUSE_STACK === "1";
if (reuse && !(process.env.PENNY_API_URL && process.env.PENNY_TEST_TOKEN && process.env.PENNY_TEST_RUN)) {
  console.error("PENNY_E2E_REUSE_STACK=1 needs PENNY_API_URL, PENNY_TEST_TOKEN and PENNY_TEST_RUN: export them from `npm run test-env -- env`.");
  process.exit(1);
}

const playwright = ["playwright", "test", ...process.argv.slice(2)];
const result = reuse
  ? spawnSync("npx", playwright, { cwd: app, stdio: "inherit", env: { ...process.env, PENNY_REAL_STACK: "1" } })
  : spawnSync(process.execPath, [runner, "run", "--oidc", "--", "npx", ...playwright], { cwd: app, stdio: "inherit", env: { ...process.env, PENNY_REAL_STACK: "1" } });
process.exit(result.status ?? 1);
