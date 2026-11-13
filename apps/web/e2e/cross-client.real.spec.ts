import { expect, test, type Page } from "@playwright/test";
import type { Ledger } from "../../../src/domain/ledger.ts";
import { mergeLedger } from "../../../src/domain/merge.ts";
import { LedgerClient, realStack, signIn, skipReason, testUser, type LedgerSnapshot } from "./stack";

// MAZ-96 cross-client convergence: the browser and a second client that speaks the native app's
// ledger protocol (docs/ios-offline-sync.md: bearer GET, revision-checked whole-ledger PUT, 409 on
// a stale revision, then the shared three-way merge `src/domain/merge.ts`, which the Swift
// `LedgerMerge` is held to through contracts/fixtures/merge-conflicts.json) against one real .NET
// API and PostgreSQL. The protocol client stands in for the iOS Simulator where Xcode is not
// available; `docs/acceptance.md` gives the simulator orchestration and what it still has to prove.
//
//   npm run build && npm run test:e2e:real -- cross-client.real
test.skip(!realStack, skipReason);
test.describe.configure({ mode: "serial", timeout: 120_000 });

const AT = "2026-10-20T15:00:00Z";
const results = (page: Page) => page.getByRole("region", { name: "Search results" });
const spent = (page: Page) => page.getByRole("region", { name: "October 2026" }).getByText("Spent", { exact: true }).locator("..");

const asLedger = (snapshot: LedgerSnapshot) => snapshot.ledger as unknown as Ledger;

/** The native sync loop: merge pending work onto the latest server copy and retry on 409. */
async function sync(client: LedgerClient, base: LedgerSnapshot, local: Ledger) {
  let attempts = 0;
  let current = base;
  let result = await client.write(current.revision, local);
  while (result.status === 409 && attempts < 5) {
    attempts += 1;
    const remote = await client.read();
    const merged = mergeLedger(asLedger(base), local, asLedger(remote));
    current = remote;
    result = await client.write(current.revision, merged);
  }
  expect(result.status, "native sync").toBe(200);
  return { conflicts: attempts, snapshot: await client.read() };
}

function octoberSpentCents(snapshot: LedgerSnapshot) {
  return snapshot.ledger.transactions.filter((item) => item.kind === "expense" && item.date.startsWith("2026-10")).reduce((sum, item) => sum + item.share, 0);
}

const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

test("offline native entries, a web entry, web edits and independent and same-field races converge with the same totals", async ({ browser, baseURL }) => {
  const user = await testUser("xclient");
  const native = await LedgerClient.signIn(user);
  const web = await signIn(browser, baseURL, user, AT);
  const page = web.page;

  // The native client downloads, then goes offline and records two expenses locally.
  const base = await native.read();
  const category = base.ledger.categories.find((item) => item.kind === "expense");
  if (!category) throw new Error("The default ledger has no expense category.");
  const offline = (id: string, title: string, cents: number, date: string) => ({ id, title, kind: "expense", total: cents, share: cents, categoryId: category.id, date, note: "" });
  const local = structuredClone(asLedger(base));
  local.transactions.push(offline("native-market", "Market", 4210, "2026-10-12") as Ledger["transactions"][number]);
  local.transactions.push(offline("native-bus", "Bus pass", 9500, "2026-10-01") as Ledger["transactions"][number]);

  // Meanwhile the web adds an entry online, so the native copy is now stale.
  await page.goto("/transactions?month=2026-10");
  await expect(page.getByRole("region", { name: "October 2026" })).toBeVisible();
  await page.getByRole("button", { name: "Add entry" }).click();
  const add = page.getByRole("form", { name: "Add entry" });
  await add.getByLabel("Amount (CAD)").fill("14");
  await add.getByLabel("Title").fill("Lunch");
  await add.getByLabel("Date").fill("2026-10-15");
  await page.getByRole("dialog", { name: "Add entry" }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Expense added")).toBeVisible();
  await expect.poll(async () => (await native.read()).revision).toBeGreaterThan(base.revision);

  // Reconnect: the server refuses the stale revision, the client merges and writes once.
  const first = await sync(native, base, local);
  expect(first.conflicts).toBe(1);
  expect(first.snapshot.ledger.transactions.map((item) => item.title).sort()).toEqual(["Bus pass", "Lunch", "Market"]);

  // The web reads the native entries; totals match the server's.
  await page.reload();
  await expect(results(page).locator(".results__title")).toHaveText(["Lunch", "Market", "Bus pass"]);
  await expect(spent(page)).toContainText(dollars(octoberSpentCents(first.snapshot)));
  expect(octoberSpentCents(first.snapshot)).toBe(4210 + 9500 + 1400);

  // The web edits a native entry; the native client reads it back.
  await results(page).locator('[data-row-key="personal:native-market"]').click();
  await page.getByRole("dialog", { name: "Market" }).getByRole("button", { name: "Edit" }).click();
  let edit = page.getByRole("form", { name: "Edit entry" });
  await edit.getByLabel("Amount (CAD)").fill("45.10");
  await page.getByRole("dialog", { name: "Edit entry" }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Changes saved")).toBeVisible();
  await expect.poll(async () => (await native.read()).ledger.transactions.find((item) => item.id === "native-market")?.total).toBe(4510);

  // Independent race: the web edits Bus pass while the native client changes Lunch. Both survive.
  const nativeBase = await native.read();
  await results(page).locator('[data-row-key="personal:native-bus"]').click();
  await page.getByRole("dialog", { name: "Bus pass" }).getByRole("button", { name: "Edit" }).click();
  edit = page.getByRole("form", { name: "Edit entry" });
  await edit.getByLabel("Title").fill("Monthly bus pass");
  const nativeLocal = structuredClone(asLedger(nativeBase));
  const lunch = nativeLocal.transactions.find((item) => item.title === "Lunch");
  if (!lunch) throw new Error("Lunch is missing");
  lunch.total = 1600;
  lunch.share = 1600;
  const raced = await sync(native, nativeBase, nativeLocal);
  expect(raced.conflicts).toBe(0);
  await page.getByRole("dialog", { name: "Edit entry" }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Changes saved")).toBeVisible();
  await expect
    .poll(async () => {
      const ledger = (await native.read()).ledger.transactions;
      return [ledger.find((item) => item.id === "native-bus")?.title, ledger.find((item) => item.title === "Lunch")?.total];
    })
    .toEqual(["Monthly bus pass", 1600]);

  // Same-field race: both change Market's amount. The web learns of the other write and asks.
  await results(page).locator('[data-row-key="personal:native-market"]').click();
  await page.getByRole("dialog", { name: "Market" }).getByRole("button", { name: "Edit" }).click();
  edit = page.getByRole("form", { name: "Edit entry" });
  await edit.getByLabel("Amount (CAD)").fill("50");
  const sameBase = await native.read();
  const sameLocal = structuredClone(asLedger(sameBase));
  const market = sameLocal.transactions.find((item) => item.id === "native-market");
  if (!market) throw new Error("Market is missing");
  market.total = 4800;
  market.share = 4800;
  await sync(native, sameBase, sameLocal);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByRole("dialog", { name: "Market" })).toContainText("$48.00");
  await page.getByRole("dialog", { name: "Edit entry" }).getByRole("button", { name: "Save" }).click();
  const banner = edit.getByRole("alert");
  await expect(banner).toContainText("This entry changed on another device");
  await expect(banner).toContainText("$48.00");
  await expect(edit.getByLabel("Amount (CAD)")).toHaveValue("50");
  await banner.getByRole("button", { name: "Keep my changes" }).click();
  await page.getByRole("dialog", { name: "Edit entry" }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Changes saved")).toBeVisible();

  // Converged: one copy of every entry, the same values and totals on both clients.
  await expect.poll(async () => (await native.read()).ledger.transactions.find((item) => item.id === "native-market")?.total).toBe(5000);
  const final = await native.read();
  expect(final.ledger.transactions.map((item) => item.id).length).toBe(new Set(final.ledger.transactions.map((item) => item.id)).size);
  expect(final.ledger.transactions.map((item) => [item.title, item.total]).sort()).toEqual([
    ["Lunch", 1600],
    ["Market", 5000],
    ["Monthly bus pass", 9500],
  ]);
  await page.reload();
  await expect(spent(page)).toContainText(dollars(octoberSpentCents(final)));
  expect(octoberSpentCents(final)).toBe(16100);
  await web.context.close();
});

test("a deletion on the native client closes an open web edit of that entry and never resurrects it", async ({ browser, baseURL }) => {
  const user = await testUser("xdelete");
  const native = await LedgerClient.signIn(user);
  const web = await signIn(browser, baseURL, user, AT);
  const page = web.page;
  const base = await native.read();
  const category = base.ledger.categories.find((item) => item.kind === "expense");
  if (!category) throw new Error("no expense category");
  const seeded = structuredClone(asLedger(base));
  seeded.transactions.push({ id: "native-gift", title: "Gift", kind: "expense", total: 3000, share: 3000, categoryId: category.id, date: "2026-10-05", note: "" });
  const created = await sync(native, base, seeded);

  await page.goto("/transactions?month=2026-10");
  await results(page).locator('[data-row-key="personal:native-gift"]').click();
  await page.getByRole("dialog", { name: "Gift" }).getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("form", { name: "Edit entry" });
  await edit.getByLabel("Title").fill("Birthday gift");

  // The native client deletes it.
  const removed = structuredClone(asLedger(created.snapshot));
  removed.transactions = removed.transactions.filter((item) => item.id !== "native-gift");
  await sync(native, created.snapshot, removed);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  // The open edit gives way to the entry's detail, which says what happened; nothing is saved.
  const detail = page.getByRole("dialog", { name: "Gift" });
  await expect(detail).toContainText("It was deleted on another device or in another tab.");
  await expect(page.getByRole("dialog", { name: "Edit entry" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(results(page).locator('[data-row-key="personal:native-gift"]')).toHaveCount(0);
  // Nothing was written back: the server still has no Gift, under either title.
  const after = await native.read();
  expect(after.ledger.transactions.some((item) => item.id === "native-gift" || item.title === "Birthday gift")).toBe(false);
  await web.context.close();
});
