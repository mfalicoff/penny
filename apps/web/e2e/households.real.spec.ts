import { expect, test, type Browser, type Page } from "@playwright/test";
import { SAVE } from "./entry";

// The MAZ-91 two-person journeys against the real .NET API and PostgreSQL from the full-stack
// test environment (docs/reference/test-environment.md). Skipped unless PENNY_REAL_STACK=1. It
// pins the server clock through the environment's test controls (PENNY_API_URL and
// PENNY_TEST_TOKEN, exported by `test-env run`), so it never runs against a real server. CI runs
// it on Chromium, Firefox and WebKit (MAZ-95). In apps/web:
//
//   npm run build && npm run test:e2e:real -- households.real --project=chromium-desktop
//
// Accounts are new random `.test` addresses; amounts are made up.
test.skip(process.env.PENNY_REAL_STACK !== "1", "needs the full-stack test environment (PENNY_REAL_STACK=1)");
test.describe.configure({ mode: "serial", timeout: 180_000 });

const PASSWORD = "correct horse battery";

/** An expense's detail: a dialog below 1100px, the pane beside the expenses from there (MAZ-229). Recording a share retitles it Record payment. */
const expenseDetail = (page: Page, name: string) => {
  const title = new RegExp("^(" + name + "|Record payment)$");
  return page.getByRole("dialog", { name: title }).or(page.getByRole("region", { name: title }));
};

/**
 * Runs a Manage action: from 1100px it's a button on People; narrower it's in the navigation bar's
 * … menu (cards `iphone-shared`, `iphone-shared-people`).
 */
async function manage(page: Page, action: string) {
  const menu = page.getByRole("button", { name: "Household actions" });
  const button = page.getByRole("button", { name: action });
  await expect(menu.or(button).first()).toBeVisible();
  if (await menu.isVisible()) await menu.click();
  await button.click();
}

/**
 * One expense in the household's list: a row link on phones and tablets, a table row from 1100px
 * (`web-household`). Either shows the total and your share.
 */
const expenseRow = (page: Page, name: RegExp) =>
  page.getByRole("list", { name: "Expenses" }).getByRole("link", { name }).or(page.getByRole("region", { name: /^Expenses in / }).getByRole("row", { name }));

/** The link that opens an expense, in the list or the table. */
const expenseLink = (page: Page, name: RegExp) =>
  page.getByRole("list", { name: "Expenses" }).getByRole("link", { name }).or(page.getByRole("region", { name: /^Expenses in / }).getByRole("link", { name }));
const OCT_30 = "2026-10-30T15:00:00Z";
const OCT_31 = "2026-10-31T15:00:00Z";

async function pinClock(iso: string | null) {
  const api = process.env.PENNY_API_URL;
  const token = process.env.PENNY_TEST_TOKEN;
  if (!api || !token) throw new Error("PENNY_API_URL and PENNY_TEST_TOKEN come from `node scripts/test-env/penny-env.mjs run`.");
  const response = await fetch(`${api}/api/test/clock`, {
    method: iso ? "PUT" : "DELETE",
    headers: { "X-Penny-Test-Token": token, "Content-Type": "application/json" },
    ...(iso ? { body: JSON.stringify({ now: iso }) } : {}),
  });
  if (!response.ok) throw new Error(`clock: ${String(response.status)}`);
}

async function register(browser: Browser, baseURL: string | undefined, label: string, at: string) {
  const email = `${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@penny.test`;
  const context = await browser.newContext(baseURL ? { baseURL } : {});
  const page = await context.newPage();
  await page.clock.setFixedTime(at);
  const response = await page.request.post("/api/auth/register", { data: { email, password: PASSWORD } });
  expect(response.status()).toBe(201);
  return { email, context, page };
}

async function addAccount(page: Page, account: { id: string; name: string }) {
  const read = await page.request.get("/api/ledger");
  const snapshot = (await read.json()) as { revision: number; ledger: { accounts?: unknown[] } };
  const write = await page.request.put("/api/ledger", {
    data: { revision: snapshot.revision, ledger: { ...snapshot.ledger, accounts: [...(snapshot.ledger.accounts ?? []), { ...account, type: "credit" }] } },
  });
  expect(write.ok()).toBe(true);
}

test.afterAll(async () => {
  await pinClock(null);
});

test("two people: invite, splits, private account, stale payment, monthly settlement and archive", async ({ browser, baseURL }) => {
  await pinClock(OCT_30);
  const alex = await register(browser, baseURL, "alex", OCT_30);
  const bea = await register(browser, baseURL, "bea", OCT_30);
  await addAccount(alex.page, { id: "acct-alex-card", name: "Alex everyday card" });
  const seenByBea: string[] = [];
  bea.page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/api/households")) {
      void response
        .text()
        .then((text) => seenByBea.push(text))
        .catch(() => undefined);
    }
  });

  // Alex creates the household and an invite code; Bea joins with it.
  await alex.page.goto("/households");
  await alex.page.getByRole("list", { name: "Start sharing" }).getByRole("button", { name: /New household/ }).click();
  await alex.page.getByRole("dialog", { name: "New household" }).getByLabel("Name").fill("Maison");
  await alex.page.getByRole("button", { name: "Create household" }).click();
  await expect(alex.page.getByRole("heading", { level: 1, name: "Maison" })).toBeVisible();
  const url = new URL(alex.page.url()).pathname;
  await alex.page.getByRole("button", { name: "Create invite code" }).click();
  const code = (await alex.page.locator(".invite-code__value").innerText()).replace(/\s/g, "");
  expect(code).toMatch(/^[A-F0-9]{10}$/);

  await bea.page.goto("/households");
  await bea.page.getByRole("button", { name: /Join with a code/ }).click();
  const join = bea.page.getByRole("dialog", { name: "Join a household" });
  await join.getByLabel("Invite code").fill("0000000000");
  await join.getByRole("button", { name: "Join household" }).click();
  await expect(join.getByRole("alert")).toHaveText("Invite code is invalid or expired.");
  await join.getByLabel("Invite code").fill(code);
  await join.getByRole("button", { name: "Join household" }).click();
  await expect(bea.page.getByRole("heading", { level: 1, name: "Maison" })).toBeVisible();

  // Alex adds an equal and an exact split, paying from his private account.
  await alex.page.goto(url);
  for (const [title, amount, shares] of [
    ["Hydro", "90", null],
    ["Internet", "60", ["40", "20"]],
  ] as const) {
    await alex.page.getByRole("button", { name: "Shared expense" }).click();
    const form = alex.page.getByRole("dialog", { name: "New expense" });
    await form.getByLabel(/^Amount \(/).fill(amount);
    await form.getByLabel("Title").fill(title);
    await form.getByLabel("Date").fill("2026-10-30");
    await form.getByLabel("Your account").selectOption({ label: "Alex everyday card" });
    if (shares) {
      // The form is taller now; centre the split so the dialog's sticky footer can't take the click.
      const amounts = form.getByRole("radio", { name: "Amounts" });
      await amounts.evaluate((element) => { element.scrollIntoView({ block: "center" }); });
      await amounts.check({ force: true });
      await form.getByLabel("Your share in CAD").fill(shares[0]);
      await form.getByLabel(`${bea.email}'s share in CAD`).fill(shares[1]);
    }
    await form.getByRole("button", { name: SAVE }).click();
    await expect(form).toBeHidden();
  }

  // Bea sees totals and her shares, never Alex's account, and repays Hydro on its own.
  await bea.page.goto(url);
  const list = { row: (name: RegExp) => expenseRow(bea.page, name), link: (name: RegExp) => expenseLink(bea.page, name) };
  await expect(list.row(/Hydro/)).toContainText("$45.00");
  await expect(list.row(/Internet/)).toContainText("$20.00");
  await list.link(/Hydro/).click();
  const hydro = expenseDetail(bea.page, "Hydro");
  await expect(hydro.getByText("The payer's account stays private to them.")).toBeVisible();
  await hydro.getByRole("button", { name: "Mark your share as paid" }).click();
  await hydro.getByRole("button", { name: "Mark $45.00 as paid" }).click();
  await expect(hydro.getByText("Repaid", { exact: true })).toBeVisible();
  await bea.page.keyboard.press("Escape");

  // Bea opens Internet's payment; Alex changes the shares first. The server refuses (409).
  await list.link(/Internet/).click();
  const internet = expenseDetail(bea.page, "Internet");
  await internet.getByRole("button", { name: "Mark your share as paid" }).click();
  await alex.page.getByRole("link", { name: /Internet/ }).click();
  await expenseDetail(alex.page, "Internet").getByRole("button", { name: "Edit" }).click();
  const edit = alex.page.getByRole("dialog", { name: "Edit expense" });
  await edit.getByLabel("Your share in CAD").fill("30");
  await edit.getByLabel(`${bea.email}'s share in CAD`).fill("30");
  await edit.getByRole("button", { name: SAVE }).click();
  await expect(edit).toBeHidden();
  await internet.getByRole("button", { name: "Mark $20.00 as paid" }).click();
  const stale = internet.getByRole("alert");
  await expect(stale).toContainText("Internet changed");
  await expect(stale.locator("dt", { hasText: /^Your share$/ }).locator("..")).toContainText("$30.00");
  await expect(stale).toContainText("Nothing was recorded.");
  await stale.getByRole("button", { name: "Review expense" }).click();
  await bea.page.keyboard.press("Escape");

  // Archive is refused while October is unsettled.
  await alex.page.goto(`${url}?tab=people`);
  await manage(alex.page, "Archive household");
  const archive = alex.page.getByRole("dialog", { name: "Archive Maison?" });
  await archive.getByRole("button", { name: "Archive" }).click();
  await expect(archive.getByRole("alert")).toContainText("Settle all monthly balances before archiving.");
  await archive.getByRole("button", { name: "Cancel" }).click();

  // October 31: both record the same monthly transfer; only one is stored.
  await pinClock(OCT_31);
  await alex.page.clock.setFixedTime(OCT_31);
  await bea.page.clock.setFixedTime(OCT_31);
  await alex.page.goto(`${url}?tab=balances`);
  await bea.page.goto(`${url}?tab=balances`);
  await alex.page.getByRole("button", { name: `Record that ${bea.email} paid You $30.00` }).click();
  await bea.page.getByRole("button", { name: `Record that You paid ${alex.email} $30.00` }).click();
  await bea.page.getByRole("dialog", { name: "Record payment" }).getByRole("button", { name: "Mark $30.00 as paid" }).click();
  await expect(bea.page.getByText("Payment recorded")).toBeVisible();
  await alex.page.getByRole("dialog", { name: "Record payment" }).getByRole("button", { name: "Mark $30.00 as paid" }).click();
  await expect(alex.page.getByRole("alert", { name: "October 2026 changed" })).toContainText("Nothing was recorded.");
  await alex.page.getByRole("button", { name: "Review balances" }).click();
  await expect(alex.page.getByText("Everyone is settled for October 2026.")).toBeVisible();

  // The history shows both payments; the audit never carries the payer's account.
  await alex.page.goto(`${url}?tab=history`);
  const history = alex.page.getByRole("region", { name: "History" });
  await history.getByRole("radio", { name: "Payments" }).check({ force: true });
  await expect(history).toContainText(`${bea.email} recorded a payment$30.00 to You for the month`);

  // Settled: archive succeeds, and Bea's copy turns read-only.
  await alex.page.goto(`${url}?tab=people`);
  await manage(alex.page, "Archive household");
  await alex.page.getByRole("dialog", { name: "Archive Maison?" }).getByRole("button", { name: "Archive" }).click();
  await expect(alex.page.getByRole("heading", { level: 1, name: "Shared" })).toBeVisible();
  await bea.page.goto(url);
  await expect(bea.page.getByText("This household is archived")).toBeVisible();
  await expect(bea.page.getByRole("button", { name: "Shared expense" })).toHaveCount(0);
  expect(seenByBea.join("\n")).not.toContain("acct-alex-card");

  await alex.context.close();
  await bea.context.close();
});
