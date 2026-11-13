import { spawnSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { syntheticPdf } from "./fixtures/receipts";
import { clearFaults, LedgerClient, pinClock, realStack, setFaults, signIn, skipReason, testUser, type TestUser } from "./stack";

// MAZ-96 failure and recovery journeys against the real .NET API and PostgreSQL: injected 503s and
// dropped connections (the environment's fault controls, applied before routing), a server that is
// unreachable through a reload, a session that expires by server time with a change waiting, a
// failed receipt upload and a paused database. Every journey ends with the server holding each
// change exactly once.
//
//   npm run build && npm run test:e2e:real -- recovery.real
test.skip(!realStack, skipReason);
test.describe.configure({ mode: "serial", timeout: 120_000 });

const AT = "2026-10-20T15:00:00Z";
const results = (page: Page) => page.getByRole("region", { name: "Search results" });

test.afterEach(async () => {
  await clearFaults();
  await pinClock(null);
});

async function open(page: Page) {
  await page.goto("/transactions?month=2026-10");
  await expect(page.getByRole("region", { name: "October 2026" })).toBeVisible();
  await expect(results(page).getByRole("status")).toBeVisible();
}

async function addExpense(page: Page, title: string, amount: string) {
  await page.getByRole("button", { name: "Add entry" }).first().click();
  const add = page.getByRole("form", { name: "Add entry" });
  await add.getByLabel("Amount (CAD)").fill(amount);
  await add.getByLabel("Title").fill(title);
  await add.getByLabel("Date").fill("2026-10-18");
  await page.getByRole("dialog", { name: "Add entry" }).getByRole("button", { name: "Save" }).click();
}

async function serverTitles(user: TestUser) {
  const client = await LedgerClient.signIn(user);
  return (await client.read()).ledger.transactions.map((item) => item.title);
}

test("a 503 and a dropped connection on the ledger write are retried into exactly one saved entry", async ({ browser, baseURL }) => {
  const user = await testUser("fault");
  const { page, context } = await signIn(browser, baseURL, user, AT);
  await open(page);

  await setFaults([{ method: "PUT", pathPrefix: "/api/ledger", status: 503, times: 1 }]);
  await addExpense(page, "Pharmacy", "12");
  await expect(page.getByText(/Expense added|Saved on this device/)).toBeVisible();
  await expect.poll(() => serverTitles(user), { timeout: 20_000 }).toEqual(["Pharmacy"]);

  await setFaults([{ method: "PUT", pathPrefix: "/api/ledger", abort: true, times: 1 }]);
  await addExpense(page, "Bookshop", "21.50");
  // The browser may need a nudge after a dropped connection: Retry when it offers one.
  const retry = page.getByRole("button", { name: "Retry" });
  await expect
    .poll(
      async () => {
        if (await retry.isVisible()) await retry.click().catch(() => undefined);
        return (await serverTitles(user)).sort();
      },
      { timeout: 30_000 },
    )
    .toEqual(["Bookshop", "Pharmacy"]);
  await expect(page.getByText(/change(s)? waiting/)).toHaveCount(0);
  await context.close();
});

test("an unreachable server through a reload keeps the cached ledger and a new change, then syncs once", async ({ browser, baseURL }) => {
  const user = await testUser("unreachable");
  const { page, context } = await signIn(browser, baseURL, user, AT);
  await open(page);
  await addExpense(page, "Before outage", "5");
  await expect.poll(() => serverTitles(user)).toEqual(["Before outage"]);

  // The server stops answering while the page is open: the cached ledger stays usable.
  await setFaults([{ pathPrefix: "/api/", abort: true }]);
  await addExpense(page, "During outage", "7.25");
  await expect(page.getByText("Not synced · 1 change waiting")).toBeVisible({ timeout: 20_000 });
  await expect(results(page)).toContainText("Before outage");
  await expect(results(page).getByRole("listitem").filter({ hasText: "During outage" })).toContainText("Waiting to sync");

  // A reload can't confirm the session, so start-up says so; nothing is signed out or cleared.
  await page.reload();
  const startup = page.getByRole("alert").filter({ has: page.getByRole("heading", { name: "Penny can't reach the server" }) });
  await expect(startup).toContainText("Your data is safe.", { timeout: 20_000 });

  // The server returns: Try again re-checks the session and the waiting change is sent once.
  await clearFaults();
  await startup.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Activity" })).toBeVisible();
  const retry = page.getByRole("button", { name: "Retry" });
  await expect
    .poll(
      async () => {
        if (await retry.first().isVisible()) await retry.first().click().catch(() => undefined);
        return (await serverTitles(user)).sort();
      },
      { timeout: 20_000 },
    )
    .toEqual(["Before outage", "During outage"]);
  await expect(page.getByText(/change(s)? waiting/)).toHaveCount(0);
  // Same day: the server orders ties by key, so only the set is fixed.
  await expect(results(page).locator(".results__title")).toHaveCount(2);
  expect((await results(page).locator(".results__title").allInnerTexts()).sort()).toEqual(["Before outage", "During outage"]);
  await context.close();
});

test("a session that expires by server time keeps the waiting change and syncs it after signing in again", async ({ browser, baseURL }) => {
  await pinClock("2026-10-15T12:00:00Z");
  const user = await testUser("expiry");
  const { page, context } = await signIn(browser, baseURL, user, AT);
  await open(page);

  // A change waits in this browser while the ledger write can't get through.
  await setFaults([{ method: "PUT", pathPrefix: "/api/ledger", abort: true }]);
  await addExpense(page, "Written at expiry", "9.99");
  await expect(page.getByText(/1 change waiting/)).toBeVisible({ timeout: 20_000 });

  // Sessions last 30 days of server time. Whichever request reaches the server next (a refetch or
  // the retried write) gets 401, and the browser returns to sign-in with the change kept.
  await pinClock("2026-11-15T12:00:00Z");
  await clearFaults();
  const retry = page.getByRole("button", { name: "Retry" }).first();
  if (await retry.isVisible()) await retry.click().catch(() => undefined);
  await expect(page.getByText("Your session ended. Sign in again to continue. Changes waiting to sync are kept on this device.")).toBeVisible({ timeout: 20_000 });
  expect(await serverTitles(user)).toEqual([]);
  await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();
  // Signing in again returns to the page and sends the change once. (Unlike iOS, the web does not
  // prefill the expired account's email: docs/acceptance.md, known gaps.)
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Activity" })).toBeVisible();
  await expect.poll(() => serverTitles(user), { timeout: 20_000 }).toEqual(["Written at expiry"]);
  await expect(page.getByText(/change(s)? waiting/)).toHaveCount(0);
  await context.close();
});

test("a failed receipt upload keeps the draft and succeeds on Try again", async ({ browser, baseURL }) => {
  const user = await testUser("receiptfail");
  const { page, context } = await signIn(browser, baseURL, user, AT);
  await open(page);
  await page.getByRole("button", { name: "Add entry" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add entry" });
  await dialog.getByLabel("Amount (CAD)").fill("30");
  await dialog.getByLabel("Title").fill("Hardware store");
  await dialog.getByRole("button", { name: /More details/ }).click();
  const field = dialog.getByRole("group", { name: "Receipt" });

  await setFaults([{ method: "POST", pathPrefix: "/api/receipts", status: 503, times: 1 }]);
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "Attach a file or PDF" }).click();
  await (await chooser).setFiles({ name: "hardware.pdf", mimeType: "application/pdf", buffer: syntheticPdf(1) });
  await expect(field.getByRole("alert")).toContainText("The upload didn't finish. Try again.");
  await expect(dialog.getByLabel("Title")).toHaveValue("Hardware store");
  await field.getByRole("button", { name: "Try again" }).click();
  await expect(field.getByRole("button", { name: "Preview hardware.pdf" })).toBeVisible();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Expense added")).toBeVisible();
  await expect
    .poll(async () => {
      const client = await LedgerClient.signIn(user);
      const ledger = (await client.read()).ledger.transactions as { title: string; receipt?: { uri: string } }[];
      return ledger.filter((item) => item.title === "Hardware store").map((item) => /^\/api\/receipts\/[0-9a-f]{32}$/.test(item.receipt?.uri ?? ""));
    })
    .toEqual([true]);
  await context.close();
});

/** The container CLI and name of this run's PostgreSQL, when it runs in a container. */
function databaseContainer() {
  const run = process.env.PENNY_TEST_RUN;
  if (!run) return null;
  const name = `penny-test-${run}`;
  for (const cli of [process.env.PENNY_CONTAINER_CLI, "docker", "podman"].filter((value): value is string => Boolean(value))) {
    const probe = spawnSync(cli, ["inspect", name], { encoding: "utf8" });
    if (probe.status === 0) return { cli, name };
  }
  return null;
}

test("a paused database turns writes into waiting changes, and they sync once it is back", async ({ browser, baseURL }) => {
  const database = databaseContainer();
  test.skip(!database, "PostgreSQL is not in a container this runner can pause (PENNY_POSTGRES=native)");
  if (!database) return;
  const user = await testUser("dbpause");
  const { page, context } = await signIn(browser, baseURL, user, AT);
  await open(page);
  const api = process.env.PENNY_API_URL ?? "";

  expect(spawnSync(database.cli, ["pause", database.name]).status).toBe(0);
  try {
    // Readiness checks the database; it must report the outage rather than hang forever.
    await expect.poll(async () => (await fetch(`${api}/api/ready`, { signal: AbortSignal.timeout(15_000) }).catch(() => null))?.status ?? 0, { timeout: 45_000 }).not.toBe(200);
    await addExpense(page, "Written while the database was down", "4.20");
    await expect(page.getByText(/Not synced · 1 change waiting|Couldn't sync · 1 change waiting/)).toBeVisible({ timeout: 60_000 });
  } finally {
    spawnSync(database.cli, ["unpause", database.name]);
  }
  await expect.poll(async () => (await fetch(`${api}/api/ready`)).status, { timeout: 30_000 }).toBe(200);
  const retry = page.getByRole("button", { name: "Retry" });
  await expect
    .poll(
      async () => {
        if (await retry.first().isVisible()) await retry.first().click().catch(() => undefined);
        return serverTitles(user);
      },
      { timeout: 45_000 },
    )
    .toEqual(["Written while the database was down"]);
  await expect(page.getByText(/change(s)? waiting/)).toHaveCount(0);
  await context.close();
});
