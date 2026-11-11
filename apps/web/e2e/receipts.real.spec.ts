import { readFile } from "node:fs/promises";
import { expect, test, type Browser } from "@playwright/test";
import { sha256, syntheticPdf, syntheticPng } from "./fixtures/receipts";

// MAZ-94 receipts against the real .NET API and PostgreSQL from the full-stack test environment:
// the file is encrypted at rest by the API (AES-256-GCM, per-file key) and must come back
// byte-identical through upload, save, reload, preview and download, while another account gets
// the same 404 as for a receipt that doesn't exist. Skipped unless PENNY_REAL_STACK=1. In apps/web:
//
//   npm run build && npm run test:e2e:real -- receipts.real --project=chromium-desktop
//
// Accounts are new random `.test` addresses; files are synthetic (fixtures/receipts.ts).
test.skip(process.env.PENNY_REAL_STACK !== "1", "needs the full-stack test environment (PENNY_REAL_STACK=1)");
test.describe.configure({ mode: "serial", timeout: 180_000 });

const PASSWORD = "correct horse battery";

async function register(browser: Browser, baseURL: string | undefined, label: string) {
  const email = `${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@penny.test`;
  const context = await browser.newContext(baseURL ? { baseURL } : {});
  const page = await context.newPage();
  const response = await page.request.post("/api/auth/register", { data: { email, password: PASSWORD } });
  expect(response.status()).toBe(201);
  return { email, context, page };
}

test("a PDF and a photo survive upload, save, reload, preview and download; another account can't read them", async ({ browser, baseURL }) => {
  const alex = await register(browser, baseURL, "alex-receipts");
  const sam = await register(browser, baseURL, "sam-receipts");
  const { page } = alex;
  const pdf = syntheticPdf(2);
  const png = syntheticPng();

  await page.goto("/transactions");
  await expect(page.getByRole("heading", { level: 1, name: "Activity" })).toBeVisible();
  await page.getByRole("button", { name: "Add entry" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add entry" });
  await dialog.getByLabel("Amount (CAD)").fill("12.80");
  await dialog.getByLabel("Title").fill("Receipt round trip");
  await dialog.getByRole("button", { name: /More details/ }).click();
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "Attach a file or PDF" }).click();
  await (await chooser).setFiles({ name: "round-trip.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(dialog.getByRole("group", { name: "Receipt" }).getByRole("button", { name: "Preview round-trip.pdf" })).toBeVisible();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Expense added")).toBeVisible();

  // The ledger now links the receipt the API stored.
  await expect
    .poll(async () => {
      const ledger = (await (await page.request.get("/api/ledger")).json()) as { ledger: { transactions: { title: string; receipt?: { uri: string } }[] } };
      return ledger.ledger.transactions.find((item) => item.title === "Receipt round trip")?.receipt?.uri ?? "";
    })
    .toMatch(/^\/api\/receipts\/[0-9a-f]{32}$/);

  await page.reload();
  await page.getByRole("region", { name: "Search results" }).getByRole("button", { name: /Receipt round trip/ }).click();
  await page.getByRole("dialog", { name: "Receipt round trip" }).getByRole("button", { name: "Open receipt round-trip.pdf" }).click();
  const preview = page.getByRole("dialog", { name: "round-trip.pdf" });
  await expect(preview.getByRole("img", { name: "Page 1 of 2, round-trip.pdf" })).toHaveAttribute("data-rendered-page", "1");
  await preview.getByRole("button", { name: "Next page" }).click();
  await expect(preview.getByRole("img", { name: "Page 2 of 2, round-trip.pdf" })).toHaveAttribute("data-rendered-page", "2");
  const download = page.waitForEvent("download");
  await preview.getByRole("button", { name: "Download" }).click();
  expect(sha256(await readFile(await (await download).path()))).toBe(sha256(pdf));
  await preview.getByRole("button", { name: "Close" }).click();

  // A photo straight through the API, then read back over HTTP with each account.
  const uploaded = await page.request.post("/api/receipts", { data: { name: "photo.png", mime: "image/png", base64: png.toString("base64") } });
  expect(uploaded.status()).toBe(201);
  const { uri } = (await uploaded.json()) as { uri: string };
  const mine = await page.request.get(uri);
  expect(mine.status()).toBe(200);
  expect(mine.headers()["content-type"]).toBe("image/png");
  expect(sha256(await mine.body())).toBe(sha256(png));
  const theirs = await sam.page.request.get(uri);
  expect(theirs.status()).toBe(404);
  expect(await theirs.json()).toEqual({ error: "Receipt not found." });

  await alex.context.close();
  await sam.context.close();
});
