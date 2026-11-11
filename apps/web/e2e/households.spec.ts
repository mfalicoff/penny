import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createHouseholdServer, type HouseholdServer } from "../tests/fakes/householdServer.ts";

// Two people in two browser contexts sharing one household (MAZ-91). /api is the in-memory
// household fake from tests/fakes (documented server rules and messages), so the journeys run in
// CI without a server; households.real.spec.ts runs the same flows against .NET and PostgreSQL.
// All names and amounts are synthetic.

const ALEX = "alex@example.test";
const BEA = "bea@example.test";
const OCT_20 = Date.parse("2026-10-20T15:00:00Z");
const OCT_31 = Date.parse("2026-10-31T15:00:00Z");

let server: HouseholdServer;
let now = OCT_20;

async function person(browser: Browser, email: string, baseURL: string | undefined, options: { width?: number } = {}): Promise<{ context: BrowserContext; page: Page; served: string[] }> {
  // Each person gets the project's device (desktop or phone) unless a width is given.
  const { viewport, userAgent, isMobile, hasTouch, deviceScaleFactor } = test.info().project.use;
  const device = { ...(viewport ? { viewport } : {}), ...(userAgent ? { userAgent } : {}), ...(isMobile ? { isMobile } : {}), ...(hasTouch ? { hasTouch } : {}), ...(deviceScaleFactor ? { deviceScaleFactor } : {}) };
  const context = await browser.newContext({ ...device, ...(baseURL ? { baseURL } : {}), ...(options.width ? { viewport: { width: options.width, height: 900 } } : {}) });
  const served: string[] = [];
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/info") return route.fulfill({ json: { name: "penny", version: "2.0.0-e2e" } });
    if (url.pathname === "/api/auth/me") return route.fulfill({ json: { email } });
    if (url.pathname === "/api/auth/oidc") return route.fulfill({ json: { enabled: false } });
    if (url.pathname === "/api/v1/search/transactions") return route.fulfill({ json: { version: 1, items: [], totalCount: 0, nextCursor: null } });
    const body = request.postData() ? (JSON.parse(request.postData() ?? "{}") as Record<string, unknown>) : {};
    const result = server.handle(email, request.method(), `${url.pathname}${url.search}`, body);
    served.push(JSON.stringify(result.body));
    return route.fulfill({ status: result.status, json: result.body });
  });
  const page = await context.newPage();
  await page.clock.setFixedTime(now);
  return { context, page, served };
}

async function setNow(instant: number, ...pages: Page[]) {
  now = instant;
  for (const page of pages) await page.clock.setFixedTime(instant);
}

const horizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.beforeEach(() => {
  now = OCT_20;
  server = createHouseholdServer({ now: () => now });
});

/** Alex creates Maison and shares a code; Bea joins with it. Returns the household URL. */
async function createAndJoin(alex: Page, bea: Page) {
  await alex.goto("/households");
  await alex.getByRole("button", { name: /New household/ }).click();
  const create = alex.getByRole("dialog", { name: "New household" });
  await create.getByLabel("Name").fill("Maison");
  await create.getByRole("button", { name: "Create household" }).click();
  await expect(alex.getByRole("heading", { level: 1, name: "Maison" })).toBeVisible();
  await alex.getByRole("button", { name: "Create invite code" }).click();
  await expect(alex.getByText(/Expires in/)).toBeVisible();
  const code = server.state.invites[0]?.code ?? "";
  const url = new URL(alex.url()).pathname;

  await bea.goto("/households");
  await bea.getByRole("button", { name: /Join with a code/ }).click();
  const join = bea.getByRole("dialog", { name: "Join a household" });
  await join.getByLabel("Invite code").fill(`${code.slice(0, 5)} ${code.slice(5)}`);
  await join.getByRole("button", { name: "Join household" }).click();
  await expect(bea.getByRole("heading", { level: 1, name: "Maison" })).toBeVisible();
  return url;
}

async function addExpense(page: Page, title: string, amount: string, options: { split?: "Amounts" | "Percent"; shares?: [string, string][]; date?: string } = {}) {
  await page.getByRole("button", { name: "Shared expense" }).click();
  const form = page.getByRole("dialog", { name: "New shared expense" });
  await form.getByLabel(/^Total/).fill(amount);
  await form.getByLabel("Title").fill(title);
  await form.getByLabel("Date").fill(options.date ?? "2026-10-20");
  if (options.split) {
    await form.getByRole("radio", { name: options.split }).check({ force: true });
    for (const [label, value] of options.shares ?? []) await form.getByLabel(label).fill(value);
  }
  await form.getByRole("button", { name: "Add expense" }).click();
  await expect(form).toBeHidden();
}

test("invite expiry, joining, equal/exact/percent splits and a share payment across two browsers", async ({ browser, baseURL }) => {
  const alex = await person(browser, ALEX, baseURL);
  const bea = await person(browser, BEA, baseURL);
  await alex.page.goto("/households");
  await alex.page.getByRole("button", { name: /New household/ }).click();
  await alex.page.getByRole("dialog", { name: "New household" }).getByLabel("Name").fill("Maison");
  await alex.page.getByRole("button", { name: "Create household" }).click();
  await alex.page.getByRole("button", { name: "Create invite code" }).click();
  const expired = server.state.invites[0]?.code ?? "";
  await expect(alex.page.getByText(/Expires in/)).toBeVisible();
  // Eleven minutes later the code has expired on the server and on Alex's screen.
  await setNow(now + 11 * 60_000, alex.page, bea.page);

  await bea.page.goto("/households");
  await bea.page.getByRole("button", { name: /Join with a code/ }).click();
  const join = bea.page.getByRole("dialog", { name: "Join a household" });
  await join.getByLabel("Invite code").fill(expired);
  await join.getByRole("button", { name: "Join household" }).click();
  await expect(join.getByRole("alert")).toHaveText("Invite code is invalid or expired.");
  await expect(join.getByLabel("Invite code")).toHaveValue(expired);

  // The code card notices its code expired and offers a new one.
  await expect(alex.page.getByText("That code expired.")).toBeVisible();
  await alex.page.getByRole("button", { name: "Create a new code" }).click();
  await expect(alex.page.getByText(/Expires in/)).toBeVisible();
  const live = server.state.invites[0]?.code ?? "";
  await join.getByLabel("Invite code").fill(live);
  await join.getByRole("button", { name: "Join household" }).click();
  await expect(bea.page.getByRole("heading", { level: 1, name: "Maison" })).toBeVisible();

  await alex.page.reload();
  await alex.page.getByRole("link", { name: "Expenses" }).click();
  await addExpense(alex.page, "Groceries", "90.01");
  await addExpense(alex.page, "Internet", "60", { split: "Amounts", shares: [["Your share in CAD", "40"], [`${BEA}'s share in CAD`, "20"]] });
  await addExpense(alex.page, "Rent", "2000", { split: "Percent", shares: [["Your share in percent", "60"], [`${BEA}'s share in percent`, "40"]] });

  // Bea sees every expense with her own share and the original total.
  await bea.page.reload();
  const list = bea.page.getByRole("list", { name: "Expenses" });
  await expect(list.getByRole("link", { name: /Groceries/ })).toContainText("$90.01");
  await expect(list.getByRole("link", { name: /Groceries/ })).toContainText("$45.00 your share");
  await expect(list.getByRole("link", { name: /Internet/ })).toContainText("$20.00 your share");
  await expect(list.getByRole("link", { name: /Rent/ })).toContainText("$800.00 your share");
  await expect(bea.page.getByText(/October · you owe/)).toContainText("$865.00");

  await list.getByRole("link", { name: /Groceries/ }).click();
  const detail = bea.page.getByRole("dialog", { name: "Groceries" });
  await detail.getByRole("button", { name: "Mark your share as paid" }).click();
  await expect(detail.getByText(/it doesn't send money/)).toBeVisible();
  await detail.getByRole("button", { name: "Mark $45.00 as paid" }).click();
  await expect(bea.page.getByText("Share marked as paid")).toBeVisible();
  await expect(detail.getByText("Repaid", { exact: true })).toBeVisible();

  await alex.page.reload();
  await alex.page.getByRole("link", { name: "Balances" }).click();
  await expect(alex.page.getByRole("list", { name: "Balances for October 2026" })).toContainText("+$820.00");
  await alex.context.close();
  await bea.context.close();
});

test("concurrent edits keep the loser's draft and a stale payment records nothing", async ({ browser, baseURL }) => {
  const alex = await person(browser, ALEX, baseURL);
  const bea = await person(browser, BEA, baseURL);
  const url = await createAndJoin(alex.page, bea.page);
  await alex.page.goto(url);
  await addExpense(alex.page, "Hydro", "96.30");
  await bea.page.goto(url);

  // Both open the same expense; Alex saves first.
  await alex.page.getByRole("link", { name: /Hydro/ }).click();
  await alex.page.getByRole("dialog", { name: "Hydro" }).getByRole("button", { name: "Edit" }).click();
  await bea.page.getByRole("link", { name: /Hydro/ }).click();
  await bea.page.getByRole("dialog", { name: "Hydro" }).getByRole("button", { name: "Edit" }).click();
  const beaForm = bea.page.getByRole("dialog", { name: "Edit expense" });
  await beaForm.getByLabel("Note").fill("Includes the late fee");
  const alexForm = alex.page.getByRole("dialog", { name: "Edit expense" });
  await alexForm.getByLabel(/^Total/).fill("104.10");
  await alexForm.getByRole("button", { name: "Save" }).click();
  await expect(alexForm).toBeHidden();

  await beaForm.getByRole("button", { name: "Save" }).click();
  await expect(beaForm.getByRole("alert")).toContainText("Someone else changed this while you were editing");
  await expect(beaForm.getByLabel("Note")).toHaveValue("Includes the late fee");
  await beaForm.getByRole("button", { name: "Use their version" }).click();
  await expect(beaForm.getByLabel(/^Total/)).toHaveValue("104.10");
  await beaForm.getByLabel("Note").fill("Includes the late fee");
  await beaForm.getByRole("button", { name: "Save" }).click();
  await expect(beaForm).toBeHidden();

  // Bea starts recording her share; Alex changes the total before she confirms.
  const detail = bea.page.getByRole("dialog", { name: "Hydro" });
  await detail.getByRole("button", { name: "Mark your share as paid" }).click();
  const confirm = detail.getByRole("button", { name: "Mark $52.05 as paid" });
  await expect(confirm).toBeVisible();
  await alex.page.getByRole("dialog", { name: "Hydro" }).getByRole("button", { name: "Edit" }).click();
  await alexForm.getByLabel(/^Total/).fill("110.00");
  await alexForm.getByRole("button", { name: "Save" }).click();
  // Alex's panel still held the version from before Bea's note: his draft survives the conflict.
  await expect(alexForm.getByRole("alert")).toContainText("Someone else changed this while you were editing");
  await expect(alexForm.getByLabel(/^Total/)).toHaveValue("110.00");
  await alexForm.getByRole("button", { name: "Keep my changes" }).click();
  await alexForm.getByRole("button", { name: "Save" }).click();
  await expect(alexForm).toBeHidden();
  await confirm.click();
  const stale = detail.getByRole("alert");
  await expect(stale).toContainText("Hydro changed");
  await expect(stale.getByRole("row", { name: /Your share/ })).toContainText("$55.00");
  await expect(stale).toBeFocused();
  expect(server.state.reimbursements).toHaveLength(0);
  await stale.getByRole("button", { name: "Review expense" }).click();
  await expect(detail.getByText("Your share · in your spending")).toBeVisible();
  await alex.context.close();
  await bea.context.close();
});

test("monthly payment at month end, a repeated payment, private accounts and archive rules", async ({ browser, baseURL }) => {
  const alex = await person(browser, ALEX, baseURL);
  const bea = await person(browser, BEA, baseURL);
  server.setLedger(BEA, { accounts: [{ id: "acct-bea-card", name: "Bea private card", type: "credit" }] });
  const url = await createAndJoin(alex.page, bea.page);
  await bea.page.goto(url);
  await bea.page.getByRole("button", { name: "Shared expense" }).click();
  const form = bea.page.getByRole("dialog", { name: "New shared expense" });
  await form.getByLabel(/^Total/).fill("80");
  await form.getByLabel("Title").fill("Cleaning");
  await form.getByLabel("Date").fill("2026-10-20");
  await form.getByLabel("Your account").selectOption({ label: "Bea private card" });
  await form.getByRole("button", { name: "Add expense" }).click();
  await expect(form).toBeHidden();

  // Alex never receives or sees Bea's account.
  await alex.page.goto(url);
  await alex.page.getByRole("link", { name: /Cleaning/ }).click();
  await expect(alex.page.getByText("The payer's account stays private to them.")).toBeVisible();
  await expect(alex.page.getByText("Bea private card")).toHaveCount(0);
  await alex.page.keyboard.press("Escape");
  expect(alex.served.join("\n")).not.toContain("acct-bea-card");
  expect(bea.served.join("\n")).toContain("acct-bea-card");

  // Archive is refused while October is unsettled.
  await alex.page.getByRole("link", { name: "People" }).click();
  await alex.page.getByRole("button", { name: "Archive household" }).click();
  const archive = alex.page.getByRole("dialog", { name: "Archive Maison?" });
  await archive.getByRole("button", { name: "Archive" }).click();
  await expect(archive.getByRole("alert")).toContainText("Settle all monthly balances before archiving.");
  await archive.getByRole("button", { name: "Cancel" }).click();

  // On the last day of the month both people try to record the same transfer.
  await setNow(OCT_31, alex.page, bea.page);
  await alex.page.goto(`${url}?tab=balances`);
  await bea.page.goto(`${url}?tab=balances`);
  await alex.page.getByRole("button", { name: `Record that You paid ${BEA} $40.00` }).click();
  await bea.page.getByRole("button", { name: `Record that ${ALEX} paid You $40.00` }).click();
  await bea.page.getByRole("dialog", { name: "Record payment" }).getByRole("button", { name: "Mark $40.00 as paid" }).click();
  await expect(bea.page.getByText("Payment recorded")).toBeVisible();
  await alex.page.getByRole("dialog", { name: "Record payment" }).getByRole("button", { name: "Mark $40.00 as paid" }).click();
  const stale = alex.page.getByRole("dialog", { name: "Balance changed" });
  await expect(stale).toContainText("Nothing was recorded.");
  await stale.getByRole("button", { name: "Review balances" }).click();
  await expect(alex.page.getByText("Everyone is settled for October 2026.")).toBeVisible();
  expect(server.state.reimbursements).toHaveLength(1);

  // Settled: archive works and Bea's view turns read-only.
  await alex.page.getByRole("link", { name: "People" }).click();
  await alex.page.getByRole("button", { name: "Archive household" }).click();
  await alex.page.getByRole("dialog", { name: "Archive Maison?" }).getByRole("button", { name: "Archive" }).click();
  await expect(alex.page.getByRole("heading", { level: 1, name: "Shared" })).toBeVisible();
  await bea.page.goto(url);
  await expect(bea.page.getByText("This household is archived")).toBeVisible();
  await expect(bea.page.getByRole("button", { name: "Shared expense" })).toHaveCount(0);
  await alex.context.close();
  await bea.context.close();
});

test("keyboard-only expense entry and no horizontal scrolling at 320px", async ({ browser, baseURL, isMobile }) => {
  test.skip(isMobile, "sets its own viewport");
  const alex = await person(browser, ALEX, baseURL, { width: 320 });
  const bea = await person(browser, BEA, baseURL);
  const url = await createAndJoin(alex.page, bea.page);
  await alex.page.goto(url);
  const page = alex.page;
  await page.getByRole("button", { name: "Shared expense" }).focus();
  await page.keyboard.press("Enter");
  const form = page.getByRole("dialog", { name: "New shared expense" });
  await expect(form.getByLabel(/^Total/)).toBeFocused();
  // Submitting empty moves focus to the first invalid field instead of losing the draft.
  await form.getByRole("button", { name: "Add expense" }).focus();
  await page.keyboard.press("Enter");
  await expect(form.getByLabel("Title")).toBeFocused();
  await page.keyboard.type("Late-night pizza");
  await form.getByLabel(/^Total/).focus();
  await page.keyboard.type("31.50");
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  await page.keyboard.press("Enter");
  await expect(form).toBeHidden();
  await expect(page.getByRole("link", { name: /Late-night pizza/ })).toBeVisible();
  for (const tab of ["Balances", "People"]) {
    await page.getByRole("navigation", { name: "Household sections" }).getByRole("link", { name: tab }).click();
    expect(await horizontalOverflow(page), tab).toBeLessThanOrEqual(0);
  }
  await page.goto(`${url}?tab=history`);
  await expect(page.getByRole("region", { name: "History" })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  await alex.context.close();
  await bea.context.close();
});
