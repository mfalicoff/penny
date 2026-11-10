import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { signOut } from "./shell";

// Real browser journeys for sign-in, SSO popups, expiry and sign-out against the production
// build, with /api and the identity provider mocked. The same journeys against the real
// .NET API and the local OIDC provider are in auth.real.spec.ts.

const TOKEN = "d".repeat(64);
const TRANSACTION = "e".repeat(64);
const PROVIDER = "https://sso.example.test";

interface Api {
  signedIn: string | null;
  complete: () => { status: number; body: unknown };
  requests: string[];
}

async function mockApi(context: BrowserContext, options: { sso?: boolean } = {}): Promise<Api> {
  const api: Api = {
    signedIn: null,
    complete: () => ({ status: 200, body: { token: TOKEN, email: "alex@example.test" } }),
    requests: [],
  };
  await context.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    api.requests.push(`${route.request().method()} ${url.pathname}`);
    const reply = (status: number, body: unknown) => route.fulfill({ status, json: body });
    switch (url.pathname) {
      case "/api/info":
        return reply(200, { name: "penny", version: "2.0.0-e2e" });
      case "/api/auth/me":
        return api.signedIn ? reply(200, { email: api.signedIn }) : reply(401, { error: "Please sign in to continue." });
      case "/api/auth/oidc":
        return reply(200, options.sso ? { enabled: true, label: "Acme SSO" } : { enabled: false });
      case "/api/auth/oidc/start":
        return reply(200, {
          transaction: TRANSACTION,
          authorizationUrl: `${PROVIDER}/authorize?state=s`,
          expiresAt: Date.now() + 600_000,
        });
      case "/api/auth/oidc/complete": {
        const result = api.complete();
        if (result.status === 200) api.signedIn = "alex@example.test";
        return reply(result.status, result.body);
      }
      case "/api/auth/login": {
        const body = route.request().postDataJSON() as { email: string; password: string };
        if (body.password === "wrong-password-1") return reply(401, { error: "Email or password is incorrect." });
        api.signedIn = body.email;
        return reply(200, { token: TOKEN, email: body.email });
      }
      case "/api/auth/register": {
        const body = route.request().postDataJSON() as { email: string };
        if (body.email === "taken@example.test") return reply(409, { error: "An account with this email already exists." });
        api.signedIn = body.email;
        return reply(201, { token: TOKEN, email: body.email });
      }
      case "/api/auth/logout":
        api.signedIn = null;
        return reply(200, { ok: true });
      case "/api/v1/search/transactions":
        if (!api.signedIn) return reply(401, { error: "Please sign in to continue." });
        return reply(200, { version: 1, items: [], totalCount: 0, nextCursor: null });
      default:
        return reply(404, { error: "API route not found." });
    }
  });
  return api;
}

/** The provider's authorize page: sends the browser straight back to the app's callback. */
async function mockProvider(context: BrowserContext, baseURL: string, callbackQuery: string) {
  await context.route(`${PROVIDER}/**`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><title>Acme SSO</title><script>location.replace(${JSON.stringify(`${baseURL}/auth/callback${callbackQuery}`)})</script>`,
    }),
  );
}

async function fillCredentials(page: Page, email: string, password: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
}

test("password sign-in and sign-out, with failed-submit recovery and a keyboard-only path", async ({ page, context }) => {
  const api = await mockApi(context);
  await page.goto("/transactions");
  await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();

  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByLabel("Email")).toBeFocused();
  await expect(page.getByLabel("Email")).toHaveAccessibleDescription("Enter a valid email address.");

  await fillCredentials(page, "alex@example.test", "wrong-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("Email or password is incorrect.");
  await expect(page.getByLabel("Password")).toBeFocused();
  await expect(page.getByLabel("Password")).toHaveValue("");

  await page.getByLabel("Password").fill("correct horse battery");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/transactions$/);
  await expect(page.getByRole("heading", { level: 1, name: "Activity" })).toBeVisible();

  // The session credential is an HttpOnly cookie the API sets; scripts never see it.
  expect(await page.evaluate(() => JSON.stringify([document.cookie, Object.entries(localStorage), Object.entries(sessionStorage)]))).not.toContain(TOKEN);

  await signOut(page);
  await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();
  expect(api.requests).toContain("POST /api/auth/logout");

  // Reloading stays signed out: no private data was kept.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();
});

test("account creation reports a taken email on the email field", async ({ page, context }) => {
  await mockApi(context);
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  await fillCredentials(page, "taken@example.test", "correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("alert")).toContainText("already exists");
  await expect(page.getByLabel("Email")).toBeFocused();

  await page.getByLabel("Email").fill("new@example.test");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
});

test("an expired session returns to sign-in with a notice", async ({ page, context }) => {
  const api = await mockApi(context);
  api.signedIn = "alex@example.test";
  await page.goto("/transactions");
  await expect(page.getByRole("heading", { level: 1, name: "Activity" })).toBeVisible();
  api.signedIn = null;
  await page.getByRole("searchbox", { name: "Search transactions" }).fill("coffee");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Your session ended" })).toBeVisible();
});

test.describe("single sign-on popup", () => {
  test("signs in through the popup and the callback page", async ({ page, context, baseURL }) => {
    const api = await mockApi(context, { sso: true });
    await mockProvider(context, baseURL ?? "", "?code=abc&state=s");
    await page.goto("/");
    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Continue with Acme SSO" }).click();
    const popup = await popupPromise;
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    await expect.poll(() => popup.isClosed()).toBe(true);
    expect(api.requests).toContain("POST /api/auth/oidc/complete");
  });

  test("a closed popup only shows a hint, and the user can cancel and retry", async ({ page, context }) => {
    await mockApi(context, { sso: true });
    await context.route(`${PROVIDER}/**`, (route) => route.fulfill({ contentType: "text/html", body: "<title>Acme SSO</title><p>Approve?</p>" }));
    await page.goto("/");
    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Continue with Acme SSO" }).click();
    const popup = await popupPromise;
    await expect(popup.getByText("Approve?")).toBeVisible();
    await popup.close();
    // Closed can also mean a COOP provider severed the window, so it is a hint, not a cancellation.
    await expect(page.getByText(/sign-in window looks closed/)).toBeVisible();
    await expect(page.getByText("Sign-in was cancelled. Nothing changed.")).toBeHidden();
    await page.getByRole("button", { name: "Cancel sign-in" }).click();
    await expect(page.getByText("Sign-in was cancelled. Nothing changed.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Acme SSO" })).toBeEnabled();
  });

  test("shows the server's verdict when the provider reports a failure", async ({ page, context, baseURL }) => {
    const api = await mockApi(context, { sso: true });
    api.complete = () => ({ status: 401, body: { error: "Sign-in could not be verified. Please try again and allow access to your verified email." } });
    await mockProvider(context, baseURL ?? "", "?error=access_denied&state=s");
    await page.goto("/");
    await page.getByRole("button", { name: "Continue with Acme SSO" }).click();
    await expect(page.getByRole("alert")).toContainText("Sign-in could not be verified");
    await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();
  });

  test("a blocked popup falls back to signing in within the tab", async ({ page, context, baseURL }) => {
    await mockApi(context, { sso: true });
    await mockProvider(context, baseURL ?? "", "?code=abc&state=s");
    await page.addInitScript(() => {
      window.open = () => null;
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Continue with Acme SSO" }).click();
    await expect(page.getByText(/blocked the sign-in window/)).toBeVisible();
    await page.getByRole("button", { name: "Continue in this tab" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });
});
