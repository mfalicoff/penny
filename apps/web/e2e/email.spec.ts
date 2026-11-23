import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./test";
import { createHouseholdServer, type HouseholdServer } from "../tests/fakes/householdServer.ts";

// Optional email delivery (MAZ-124) in a real browser against the production build, with /api
// mocked: password reset by email, the reset code from the server's administrator when the
// server sends no email, and invitations by email. Addresses and codes are synthetic.

const ALEX = "alex@example.test";
const CODE = "3f9a1c07e2b45d68a0c1f7e93b2d4a6c8e05f1b7d39a2c4e6f80b1d3a5c7e9f2";
const PASSWORD = "correct horse battery";

interface Api {
  signedIn: string | null;
  bodies: Record<string, unknown[]>;
}

async function mockAuth(context: BrowserContext, emailEnabled: boolean): Promise<Api> {
  const api: Api = { signedIn: null, bodies: {} };
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const reply = (status: number, body: unknown) => route.fulfill({ status, json: body });
    if (request.method() === "POST") (api.bodies[url.pathname] ??= []).push(request.postDataJSON());
    switch (url.pathname) {
      case "/api/info":
        return reply(200, { name: "penny", version: "2.0.0-e2e", emailEnabled });
      case "/api/auth/me":
        return api.signedIn ? reply(200, { email: api.signedIn }) : reply(401, { error: "Please sign in to continue." });
      case "/api/auth/oidc":
        return reply(200, { enabled: false });
      case "/api/auth/password-reset/request":
        return emailEnabled ? reply(202, { ok: true }) : reply(404, { error: "This server doesn't send email." });
      case "/api/auth/password-reset": {
        const body = request.postDataJSON() as { token: string };
        return body.token === CODE ? reply(200, { ok: true }) : reply(400, { error: "This reset code is invalid or has expired." });
      }
      default:
        return reply(404, { error: "Not found." });
    }
  });
  return api;
}

/**
 * axe (WCAG 2.0-2.2 A and AA) over the open screen. Color contrast is left out: it is the design
 * kit's known gap on every page (e2e/a11y-known.json), not something these screens add.
 */
async function expectAccessible(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).disableRules(["color-contrast"]).analyze();
  expect(result.violations.map((violation) => violation.id)).toEqual([]);
}

const signInHeading = (page: Page) => page.getByRole("heading", { level: 1, name: /Welcome back/ });

test("forgot password by email: ask for the link, wait to resend, then set a password from the link", async ({ page, context }) => {
  const api = await mockAuth(context, true);
  await page.clock.install();
  await page.goto("/");
  await expect(signInHeading(page)).toBeVisible();
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Reset your password" })).toBeVisible();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await expectAccessible(page);

  await page.getByLabel("Email").fill("max@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();
  await expect(page.getByText(/If max@example.com has a Penny account on this server/)).toBeVisible();
  const resend = page.getByRole("button", { name: /^Resend/ });
  await expect(resend).toHaveText(/Resend in\s*1:00/);
  await expectAccessible(page);
  await page.clock.runFor(61_000);
  await expect(resend).toHaveText("Resend");
  await resend.click();
  await expect(resend).toHaveText(/Resend in/);
  expect(api.bodies["/api/auth/password-reset/request"]).toEqual([{ email: "max@example.com" }, { email: "max@example.com" }]);

  // The emailed link: the code is read once and leaves the address bar.
  await page.goto(`/reset-password#code=${CODE}`);
  await expect(page.getByRole("heading", { level: 1, name: "Set a new password" })).toBeVisible();
  await expect(page).toHaveURL(/\/reset-password$/);
  expect(await page.evaluate(() => window.location.hash)).toBe("");
  await expect(page.getByLabel("Reset code")).toHaveCount(0);
  await expectAccessible(page);
  await page.getByLabel("New password").fill(PASSWORD);
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(signInHeading(page)).toBeVisible();
  await expect(page.getByText("Your password changed and every device was signed out.")).toBeVisible();
  expect(api.bodies["/api/auth/password-reset"]).toEqual([{ token: CODE, password: PASSWORD }]);
});

test("without email on the server, sign-in has no Forgot password and the reset page takes the administrator's code", async ({ page, context }) => {
  const api = await mockAuth(context, false);
  await page.goto("/");
  await expect(signInHeading(page)).toBeVisible();
  await expect(page.getByRole("link", { name: "Forgot password?" })).toHaveCount(0);
  await page.goto("/reset-password");
  await expect(page.getByRole("heading", { level: 1, name: "Set a new password" })).toBeVisible();
  await expect(page).toHaveURL(/\/reset-password$/);

  await page.getByLabel("Reset code").fill("b".repeat(64));
  await page.getByLabel("New password").fill(PASSWORD);
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page.getByText("This reset code is invalid or has expired.")).toBeVisible();
  await expect(page.getByLabel("Reset code")).toBeFocused();

  await page.getByLabel("Reset code").fill(CODE);
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(signInHeading(page)).toBeVisible();
  await expect(page.getByText("Your password changed and every device was signed out.")).toBeVisible();
  expect(api.bodies["/api/auth/password-reset"]).toHaveLength(2);
  // 320px wide: nothing scrolls sideways.
  await page.goto("/reset-password");
  await page.setViewportSize({ width: 320, height: 700 });
  await expect(page.getByLabel("Reset code")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("invite by email: send, see the status, revoke, and the invitee joins from the link", async ({ page, context }) => {
  const server: HouseholdServer = createHouseholdServer();
  server.state.emailEnabled = true;
  let signedIn = ALEX;
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/info") return route.fulfill({ json: { name: "penny", version: "2.0.0-e2e", emailEnabled: true } });
    if (url.pathname === "/api/auth/me") return route.fulfill({ json: { email: signedIn } });
    if (url.pathname === "/api/auth/oidc") return route.fulfill({ json: { enabled: false } });
    if (url.pathname === "/api/receipt-email") return route.fulfill({ json: { enabled: false, domain: null, address: null } });
    if (url.pathname === "/api/v1/search/transactions") return route.fulfill({ json: { version: 1, items: [], totalCount: 0, nextCursor: null } });
    const body = request.postData() ? (JSON.parse(request.postData() ?? "{}") as Record<string, unknown>) : {};
    const result = server.handle(signedIn, request.method(), `${url.pathname}${url.search}`, body);
    return route.fulfill({ status: result.status, json: result.body });
  });
  const { household } = server.handle(ALEX, "POST", "/api/households", { name: "Apartment", currency: "CAD" }).body as { household: { id: string } };

  await page.goto(`/households/${household.id}`);
  await expect(page.getByRole("heading", { level: 1, name: "Apartment" })).toBeVisible();
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Invite to Apartment" });
  await expect(dialog.getByText(/Nobody yet/)).toBeVisible();
  await dialog.getByLabel("Email").fill("sam@example.com");
  await dialog.getByRole("button", { name: "Send invite" }).click();
  const list = dialog.getByRole("list", { name: "Invited" });
  await expect(list.getByRole("listitem").filter({ hasText: "sam@example.com" })).toContainText("Waiting");
  await dialog.getByLabel("Email").fill("jo@example.com");
  await dialog.getByRole("button", { name: "Send invite" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expectAccessible(page);

  await dialog.getByRole("button", { name: "More for jo@example.com" }).click();
  await dialog.getByRole("button", { name: "Revoke" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();

  // The invitee opens the emailed link. The fake keeps no code for email invitations, so a shared code stands in for it.
  const { code } = server.handle(ALEX, "POST", `/api/households/${household.id}/invites`).body as { code: string };
  signedIn = "sam@example.test";
  await page.goto(`/join#code=${code}`);
  const join = page.getByRole("dialog", { name: "Join a household" });
  await expect(join.getByLabel("Invite code")).toHaveValue(code);
  await expect(page).toHaveURL(/\/households$/);
  await join.getByRole("button", { name: "Join household" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Apartment" })).toBeVisible();
});
