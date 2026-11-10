import { defineConfig, devices } from "@playwright/test";

// Smoke test of the production build served by `vite preview`, with /api mocked
// per test. Real .NET/PostgreSQL cross-browser journeys are MAZ-95.
// 4175 keeps clear of the legacy Expo Playwright server and `npm run dev` (4173).
const port = Number(process.env.PENNY_E2E_PORT ?? 4175);
// Optional system browser, e.g. on NixOS where downloaded Playwright browsers can't run.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results/e2e",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { outputFolder: "test-results/e2e-report", open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "off",
    screenshot: "only-on-failure",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npx vite preview --host 127.0.0.1",
    env: { PENNY_WEB_PORT: String(port) },
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
