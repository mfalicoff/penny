import { defineConfig, devices, type Project } from "@playwright/test";

// Two modes over the production build served by `vite preview` (MAZ-95):
//
// - Mocked smoke (default): every spec except *.real.spec.ts, with /api mocked per test.
// - Real stack (PENNY_REAL_STACK=1): only *.real.spec.ts, against the real .NET API and
//   PostgreSQL from the full-stack test environment (`npm run test:e2e:real`). vite preview
//   forwards /api to PENNY_API_URL, which `test-env run` exports.
//
// PENNY_E2E_BROWSERS picks engines (chromium, firefox, webkit; default chromium) and
// PENNY_E2E_DEVICES picks form factors (desktop, phone, tablet; default desktop,phone).
// Projects are named <browser>-<device>, e.g. `--project=webkit-phone`. This is browser
// emulation only; native simulators and devices are MAZ-81.
const realStack = process.env.PENNY_REAL_STACK === "1";
// Mocked: 4175 keeps clear of `npm run dev` (4173).
// Real: 4173 is an origin the test environment allows by default and an OIDC redirect URI
// its local provider registers.
const port = Number(process.env.PENNY_E2E_PORT ?? (realStack ? 4173 : 4175));
// Optional system browser, e.g. on NixOS where downloaded Playwright browsers can't run.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

type Browser = "chromium" | "firefox" | "webkit";
type Device = "desktop" | "phone" | "tablet";

function device(name: string) {
  const descriptor = devices[name];
  if (!descriptor) throw new Error(`Playwright has no device named "${name}"`);
  return descriptor;
}

// Firefox has no mobile emulation (Playwright refuses isMobile there), and the specs use
// isMobile to choose phone journeys, so Firefox runs desktop only; Chromium and WebKit cover
// phones and tablets.
const matrix: Record<Browser, Partial<Record<Device, Project["use"]>>> = {
  chromium: {
    desktop: device("Desktop Chrome"),
    phone: device("Pixel 7"),
    tablet: device("Galaxy Tab S9"),
  },
  firefox: {
    desktop: device("Desktop Firefox"),
  },
  webkit: {
    desktop: device("Desktop Safari"),
    phone: device("iPhone 15"),
    tablet: device("iPad (gen 11)"),
  },
};

function pick<T extends string>(variable: string, fallback: string, allowed: readonly T[]): T[] {
  const values = (process.env[variable] ?? fallback)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  for (const value of values) {
    if (!(allowed as readonly string[]).includes(value)) {
      throw new Error(`${variable}: unknown value "${value}" (expected ${allowed.join(", ")})`);
    }
  }
  return values as T[];
}

const browsers = pick<Browser>("PENNY_E2E_BROWSERS", "chromium", ["chromium", "firefox", "webkit"]);
const formFactors = pick<Device>("PENNY_E2E_DEVICES", "desktop,phone", ["desktop", "phone", "tablet"]);

const projects: Project[] = browsers.flatMap((browser) =>
  formFactors.flatMap((formFactor) => {
    const use = matrix[browser][formFactor];
    if (!use) return [];
    return [
      {
        name: `${browser}-${formFactor}`,
        // WebKit runs the two-person household journeys about 3-4x slower than Chromium
        // (30-40s on a 2-CPU machine), past the default 30s.
        ...(browser === "webkit" ? { timeout: 60_000 } : {}),
        use: { ...use, ...(browser === "chromium" && executablePath ? { launchOptions: { executablePath } } : {}) },
      },
    ];
  }),
);

export default defineConfig({
  testDir: "./e2e",
  ...(realStack ? { testMatch: "**/*.real.spec.ts" } : { testIgnore: "**/*.real.spec.ts" }),
  outputDir: "test-results/e2e",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // The real-stack specs share one server, and households.real pins its clock: one at a time.
  ...(realStack ? { workers: 1, fullyParallel: false } : {}),
  reporter: [
    ["list"],
    ...(process.env.GITHUB_ACTIONS ? [["github"] as const] : []),
    ["html", { outputFolder: "test-results/e2e-report", open: "never" }],
    ["json", { outputFile: "test-results/e2e-report/results.json" }],
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    // Kept only for failed attempts, so a retried-then-passed test still leaves its evidence.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: realStack ? "retain-on-failure" : "off",
  },
  projects,
  webServer: {
    command: "npx vite preview --host 127.0.0.1",
    env: { PENNY_WEB_PORT: String(port) },
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
