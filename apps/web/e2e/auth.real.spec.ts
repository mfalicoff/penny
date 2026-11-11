import { expect, test } from "@playwright/test";
import { signOut } from "./shell";

// The same journeys as auth.spec.ts against the real .NET API, PostgreSQL and the local
// OIDC provider from the full-stack test environment (docs/migration/test-environment.md).
// Skipped unless PENNY_REAL_STACK=1. CI runs it on Chromium, Firefox and WebKit (MAZ-95). In
// apps/web:
//
//   npm run build && npm run test:e2e:real -- auth.real
//
// The real-stack config serves the build on port 4173, one of the redirect URIs the test
// provider registers. The server clock must not be pinned (no --seed): OIDC attempts expire
// by real time.
test.skip(process.env.PENNY_REAL_STACK !== "1", "needs the full-stack test environment (PENNY_REAL_STACK=1)");

const PASSWORD = "correct horse battery";
const unique = () => `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}@penny.test`;

test("register, sign out, sign in with the wrong and right password, and expire the cookie", async ({ page, context }) => {
  const email = unique();
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  const cookies = await context.cookies();
  const session = cookies.find((cookie) => cookie.name === "penny_session");
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Lax");
  expect(await page.evaluate(() => document.cookie)).not.toContain("penny_session");

  await signOut(page);
  await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("Email or password is incorrect.");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Signing in keeps the page signed out from (as in auth.spec.ts), here Settings.
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();

  // A lost or expired cookie sends the next private request back to sign-in.
  await context.clearCookies();
  await page.goto("/transactions?q=coffee");
  await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();
});

test("single sign-on through the local provider's popup", async ({ browser, baseURL }) => {
  // The provider uses a throwaway self-signed certificate.
  const context = await browser.newContext({ ignoreHTTPSErrors: true, ...(baseURL ? { baseURL } : {}) });
  const page = await context.newPage();
  await page.goto("/");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: /^Continue with/ }).click();
  await popupPromise;
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await context.close();
});

test("a forged callback is rejected and leaves the browser signed out", async ({ page }) => {
  await page.goto("/auth/callback?code=forged&state=forged");
  await expect(page.getByRole("alert")).toContainText("no longer valid");
  await page.getByRole("link", { name: "Back to sign-in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();
});
