// Runs the real-server Playwright specs (e2e/*.real.spec.ts) against a disposable full-stack
// environment (MAZ-95): PostgreSQL 18 in a container, the migrated database, the .NET API built
// from this checkout and the local OIDC provider (docs/migration/test-environment.md). The
// environment is always torn down; its API and PostgreSQL logs are copied to
// ../../test-results/fullstack/<run id>/. Arguments are passed to `playwright test`:
//
//   npm run build && npm run test:e2e:real -- --project=firefox-desktop
//
// PENNY_E2E_BROWSERS and PENNY_E2E_DEVICES choose the projects (playwright.config.ts).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const app = fileURLToPath(new URL("..", import.meta.url));
const runner = fileURLToPath(new URL("../../../scripts/test-env/penny-env.mjs", import.meta.url));

if (!existsSync(`${app}/dist/index.html`)) {
  console.error("No production build in apps/web/dist: run `npm run build` first.");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [runner, "run", "--oidc", "--", "npx", "playwright", "test", ...process.argv.slice(2)],
  { cwd: app, stdio: "inherit", env: { ...process.env, PENNY_REAL_STACK: "1" } },
);
process.exit(result.status ?? 1);
