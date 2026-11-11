import { readFile } from "node:fs/promises";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { damagedPdf, oversizedPng, sha256, syntheticPdf, syntheticPng } from "./fixtures/receipts";

// Receipt upload, preview and download (MAZ-94) on the production build, under the production
// Content-Security-Policy (vite preview sends it). /api is mocked with the server's receipt rules
// (types, signatures, the 10 MiB limit) and access (404 for a receipt you can't read); pdf.js and
// the browser's image decoder do the real decoding. Real .NET/PostgreSQL runs are in
// receipts.real.spec.ts. Synthetic files only (fixtures/receipts.ts).

const EMAIL = "alex@example.test";
const NOV_10 = Date.parse("2026-11-10T15:00:00Z");
const MIMES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"];

interface Receipt {
  id: string;
  name: string;
  mime: string;
  uri: string;
}

interface Entry {
  id: string;
  title: string;
  kind: "expense";
  total: number;
  share: number;
  categoryId: string;
  date: string;
  note: string;
  receipt?: Receipt;
}

interface Server {
  revision: number;
  ledger: { version: 4; currency: string; accounts: unknown[]; trips: unknown[]; categories: unknown[]; transactions: Entry[]; recurring: unknown[] };
  files: Map<string, { name: string; mime: string; bytes: Buffer }>;
  uploads: number;
  /** Status for the next upload instead of storing it. */
  failNext: number | null;
  /** Holds uploads until released, to test Cancel. */
  hold: Promise<void> | null;
  /** Every private request answers 401. */
  expired: boolean;
}

async function mockApi(context: BrowserContext, transactions: Entry[] = []): Promise<Server> {
  const server: Server = {
    revision: 1,
    ledger: {
      version: 4,
      currency: "CAD",
      accounts: [],
      trips: [],
      categories: [{ id: "food", name: "Food & drinks", icon: "cafe-outline", color: "#E47850", kind: "expense" }],
      transactions,
      recurring: [],
    },
    files: new Map(),
    uploads: 0,
    failNext: null,
    hold: null,
    expired: false,
  };
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === "/api/info") return route.fulfill({ json: { name: "penny", version: "2.0.0-e2e" } });
    if (pathname === "/api/auth/oidc") return route.fulfill({ json: { enabled: false } });
    if (server.expired) return route.fulfill({ status: 401, json: { error: "Please sign in to continue." } });
    if (pathname === "/api/auth/me") return route.fulfill({ json: { email: EMAIL } });
    if (pathname === "/api/ledger") {
      if (request.method() === "PUT") {
        const body = request.postDataJSON() as { revision: number; ledger: Server["ledger"] };
        if (body.revision !== server.revision) return route.fulfill({ status: 409, json: { error: "The ledger changed." } });
        server.revision += 1;
        server.ledger = body.ledger;
      }
      return route.fulfill({ json: { revision: server.revision, ledger: server.ledger } });
    }
    if (pathname === "/api/households/projection") return route.fulfill({ json: { transactions: [], scheduled: [] } });
    if (pathname === "/api/v1/search/transactions") {
      const items = server.ledger.transactions.map((item) => ({ key: `personal:${item.id}`, source: "personal", match: null, entry: item }));
      return route.fulfill({ json: { version: 1, items, totalCount: items.length, nextCursor: null } });
    }
    if (pathname === "/api/receipts" && request.method() === "POST") {
      server.uploads += 1;
      if (server.hold) {
        await server.hold;
        // The browser cancelled this upload meanwhile; there is nobody left to answer.
        return route.fulfill({ status: 500, json: { error: "cancelled" } }).catch(() => undefined);
      }
      if (server.failNext !== null) {
        const status = server.failNext;
        server.failNext = null;
        return route.fulfill({ status, json: { error: "The server could not complete this request." } });
      }
      // The server's checks (ReceiptService): schema, then decoded size and signature.
      const body = request.postDataJSON() as { name: string; mime: string; base64: string };
      const bytes = Buffer.from(body.base64, "base64");
      const signature = body.mime === "application/pdf" ? bytes.subarray(0, 5).toString("latin1") === "%PDF-" : body.mime === "image/png" ? bytes[0] === 0x89 : true;
      if (!MIMES.includes(body.mime) || !body.name) return route.fulfill({ status: 400, json: { error: "Choose a photo or PDF smaller than 10 MB." } });
      if (!bytes.length || bytes.length > 10 * 1024 * 1024 || !signature) return route.fulfill({ status: 400, json: { error: "This file is not a supported photo or PDF, or exceeds 10 MB." } });
      const id = `r${String(server.files.size + 1).padStart(31, "0")}`;
      server.files.set(id, { name: body.name, mime: body.mime, bytes });
      return route.fulfill({ status: 201, json: { id, name: body.name, mime: body.mime, uri: `/api/receipts/${id}` } });
    }
    const receipt = /^\/api\/receipts\/([^/]+)$/.exec(pathname);
    if (receipt && request.method() === "GET") {
      const file = server.files.get(receipt[1] ?? "");
      // Someone else's receipt, or one no longer shared with you: the same 404 as a missing one.
      if (!file) return route.fulfill({ status: 404, json: { error: "Receipt not found." } });
      return route.fulfill({
        status: 200,
        body: file.bytes,
        headers: {
          "Content-Type": file.mime,
          "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          "Content-Security-Policy": "default-src 'none'; sandbox",
          "Cache-Control": "no-store",
        },
      });
    }
    return route.fulfill({ status: 404, json: { error: "API route not found." } });
  });
  return server;
}

/** Console errors and warnings, page errors and failed requests. Expected API refusals are filtered by the caller. */
function watchForErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") errors.push(`console.${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}
/** Browsers log refused requests ("Failed to load resource … 404"); those are the behaviour under test. */
const unexpected = (errors: string[]) => errors.filter((text) => !/Failed to load resource|status of (400|401|404|500)/.test(text));

async function open(page: Page, path = "/transactions?month=2026-11") {
  await page.clock.setFixedTime(NOV_10);
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

const addDialog = (page: Page) => page.getByRole("dialog", { name: "Add entry" });

async function startExpense(page: Page, title: string) {
  await page.getByRole("button", { name: "Add entry" }).first().click();
  const dialog = addDialog(page);
  await dialog.getByLabel("Amount (CAD)").fill("12.80");
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByRole("button", { name: /More details/ }).click();
  return dialog;
}

async function choose(page: Page, button: string, file: { name: string; mimeType: string; buffer: Buffer }) {
  const chooser = page.waitForEvent("filechooser");
  await addDialog(page).getByRole("button", { name: button }).click();
  await (await chooser).setFiles(file);
}

async function downloadedHash(page: Page, dialog: ReturnType<Page["getByRole"]>) {
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download" }).click();
  const file = await download;
  return { name: file.suggestedFilename(), hash: sha256(await readFile(await file.path())) };
}

test("attaches a two-page PDF, saves, and after a reload previews every page and downloads the same bytes", async ({ context, page }) => {
  const errors = watchForErrors(page);
  const server = await mockApi(context);
  const pdf = syntheticPdf(2);
  await open(page);
  const dialog = await startExpense(page, "Café receipt");
  await choose(page, "Attach a file or PDF", { name: "café-receipt.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(dialog.getByRole("group", { name: "Receipt" }).getByRole("button", { name: "Preview café-receipt.pdf" })).toBeVisible();
  await expect(dialog.getByRole("group", { name: "Receipt" })).toContainText(/PDF · \d+ (B|KB)/);
  await expect(dialog.getByRole("button", { name: "Replace with a photo" })).toBeFocused();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Expense added")).toBeVisible();
  await expect.poll(() => server.ledger.transactions.find((item) => item.title === "Café receipt")?.receipt?.name).toBe("café-receipt.pdf");
  const stored = [...server.files.values()][0];
  expect(stored && sha256(stored.bytes)).toBe(sha256(pdf));

  await page.reload();
  await page.getByRole("region", { name: "Search results" }).getByRole("button", { name: /Café receipt/ }).click();
  const detail = page.getByRole("dialog", { name: "Café receipt" });
  const opener = detail.getByRole("button", { name: "Open receipt café-receipt.pdf" });
  await opener.click();
  const preview = page.getByRole("dialog", { name: "café-receipt.pdf" });
  await expect(preview.getByRole("img", { name: "Page 1 of 2, café-receipt.pdf" })).toHaveAttribute("data-rendered-page", "1");
  // Painted by pdf.js in its worker: the canvas has real pixels, not a blank bitmap.
  expect(await preview.locator("canvas").evaluate((canvas: HTMLCanvasElement) => canvas.width > 0 && canvas.toDataURL().length > 2000)).toBe(true);
  await expect(preview.getByRole("button", { name: "Previous page" })).toHaveAttribute("aria-disabled", "true");
  await preview.getByRole("button", { name: "Next page" }).click();
  await expect(preview.getByRole("status").filter({ hasText: "Page 2 of 2" })).toBeVisible();
  await expect(preview.getByRole("img", { name: "Page 2 of 2, café-receipt.pdf" })).toHaveAttribute("data-rendered-page", "2");
  await expect(preview.getByRole("button", { name: "Next page" })).toBeFocused();

  const download = await downloadedHash(page, preview);
  expect(download).toEqual({ name: "café-receipt.pdf", hash: sha256(pdf) });
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(errors).toEqual([]);
});

test("previews a photo decoded by the browser and downloads it unchanged", async ({ context, page }) => {
  const errors = watchForErrors(page);
  const server = await mockApi(context);
  const png = syntheticPng();
  await open(page);
  const dialog = await startExpense(page, "Market");
  await choose(page, "Attach a photo", { name: "market.png", mimeType: "image/png", buffer: png });
  const field = dialog.getByRole("group", { name: "Receipt" });
  await expect(field.getByRole("button", { name: "Preview market.png" })).toBeVisible();
  const previewButton = field.getByRole("button", { name: "Preview market.png" });
  await previewButton.click();
  const preview = page.getByRole("dialog", { name: "market.png" });
  const image = preview.getByRole("img", { name: "Receipt photo: market.png" });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth)).toBe(48);
  expect(await image.getAttribute("src")).toMatch(/^blob:/);
  expect(await downloadedHash(page, preview)).toEqual({ name: "market.png", hash: sha256(png) });
  await preview.getByRole("button", { name: "Close" }).click();
  await expect(previewButton).toBeFocused();
  // The draft survives the preview: save it with the receipt.
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => server.ledger.transactions.find((item) => item.title === "Market")?.receipt?.mime).toBe("image/png");
  expect(errors).toEqual([]);
});

test("refuses unsupported, empty and oversized files before uploading, and returns focus on Dismiss", async ({ context, page }) => {
  const errors = watchForErrors(page);
  const server = await mockApi(context);
  await open(page);
  const dialog = await startExpense(page, "Refused");
  const field = dialog.getByRole("group", { name: "Receipt" });

  await choose(page, "Attach a file or PDF", { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not a receipt") });
  await expect(field.getByRole("alert")).toContainText("Penny can attach photos (JPEG, PNG, WebP, GIF, HEIC) and PDFs.");
  await expect(field.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await field.getByRole("button", { name: "Dismiss" }).click();
  await expect(field.getByRole("alert")).toHaveCount(0);
  await expect(field.getByRole("button", { name: "Attach a photo" })).toBeFocused();

  await choose(page, "Attach a photo", { name: "big.png", mimeType: "image/png", buffer: oversizedPng() });
  await expect(field.getByRole("alert")).toContainText("This file is larger than 10 MB.");
  await choose(page, "Attach a file or PDF", { name: "renamed.pdf", mimeType: "application/pdf", buffer: Buffer.from("GIF89a, not a PDF") });
  await expect(field.getByRole("alert")).toContainText("isn't a valid photo or PDF");
  await choose(page, "Attach a file or PDF", { name: "empty.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(0) });
  await expect(field.getByRole("alert")).toContainText("This file is empty.");
  expect(server.uploads).toBe(0);
  // Nothing else in the draft was touched.
  await expect(dialog.getByLabel("Title")).toHaveValue("Refused");
  expect(errors).toEqual([]);
});

test("retries a failed upload, cancels one in flight, and keeps the draft through both", async ({ context, page }) => {
  const errors = watchForErrors(page);
  const server = await mockApi(context);
  await open(page);
  const dialog = await startExpense(page, "Flaky upload");
  const field = dialog.getByRole("group", { name: "Receipt" });

  server.failNext = 500;
  await choose(page, "Attach a file or PDF", { name: "first.pdf", mimeType: "application/pdf", buffer: syntheticPdf(1) });
  await expect(field.getByRole("alert")).toContainText("The upload didn't finish. Try again.");
  await field.getByRole("button", { name: "Try again" }).click();
  await expect(field.getByRole("button", { name: "Preview first.pdf" })).toBeVisible();
  await expect(field.getByRole("alert")).toHaveCount(0);
  expect(server.uploads).toBe(2);

  let release: () => void = () => undefined;
  server.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await choose(page, "Replace with a file or PDF", { name: "second.pdf", mimeType: "application/pdf", buffer: syntheticPdf(1) });
  await expect(field.getByRole("progressbar", { name: "Uploading second.pdf" })).toBeVisible();
  // Save waits for the upload instead of saving without it.
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByRole("alert").filter({ hasText: "The receipt is still uploading" })).toBeVisible();
  await field.getByRole("button", { name: "Cancel upload" }).click();
  await expect(field.getByRole("progressbar")).toHaveCount(0);
  await expect(field.getByRole("button", { name: "Replace with a photo" })).toBeFocused();
  release();
  server.hold = null;
  // The cancelled upload never replaces the receipt already attached.
  await expect(field.getByRole("button", { name: "Preview first.pdf" })).toBeVisible();
  await expect(field).not.toContainText("second.pdf");
  await expect(dialog.getByLabel("Title")).toHaveValue("Flaky upload");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => server.ledger.transactions.find((item) => item.title === "Flaky upload")?.receipt?.name).toBe("first.pdf");
  expect(unexpected(errors)).toEqual([]);
});

test("keeps a receipt in the unsaved draft, and removing it saves the entry without one", async ({ context, page }) => {
  const server = await mockApi(context);
  await open(page);
  const dialog = await startExpense(page, "Draft with receipt");
  await choose(page, "Attach a photo", { name: "kept.png", mimeType: "image/png", buffer: syntheticPng() });
  await expect(dialog.getByRole("group", { name: "Receipt" }).getByRole("button", { name: "Preview kept.png" })).toBeVisible();
  await dialog.getByRole("button", { name: "Keep draft" }).click();
  await expect(addDialog(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Add entry" }).first().click();
  const reopened = addDialog(page);
  await expect(reopened.getByText("Your unsaved draft is back.")).toBeVisible();
  const field = reopened.getByRole("group", { name: "Receipt" });
  await expect(field.getByRole("button", { name: "Preview kept.png" })).toBeVisible();
  await field.getByRole("button", { name: "Remove kept.png" }).click();
  await expect(field.getByRole("button", { name: "Attach a photo" })).toBeFocused();
  await reopened.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => server.ledger.transactions.find((item) => item.title === "Draft with receipt")).toBeTruthy();
  expect(server.ledger.transactions.find((item) => item.title === "Draft with receipt")?.receipt).toBeUndefined();
});

test("says a damaged PDF can't be shown but still downloads it", async ({ context, page }) => {
  const errors = watchForErrors(page);
  const bytes = damagedPdf();
  const server = await mockApi(context);
  await open(page);
  const dialog = await startExpense(page, "Damaged");
  await choose(page, "Attach a file or PDF", { name: "damaged.pdf", mimeType: "application/pdf", buffer: bytes });
  await dialog.getByRole("button", { name: "Preview damaged.pdf" }).click();
  const preview = page.getByRole("dialog", { name: "damaged.pdf" });
  await expect(preview.getByRole("alert")).toContainText("This PDF can't be shown");
  expect(await downloadedHash(page, preview)).toEqual({ name: "damaged.pdf", hash: sha256(bytes) });
  expect(server.files.size).toBe(1);
  expect(unexpected(errors)).toEqual([]);
});

test("a receipt you can't read says so, and an ended session returns to sign-in", async ({ context, page }) => {
  const errors = watchForErrors(page);
  // Linked to an entry, but the server no longer lets this account read it (a household
  // receipt after leaving, or another account's): the API answers 404 either way.
  const hidden: Entry = {
    id: "e1",
    title: "Shared dinner",
    kind: "expense",
    total: 4000,
    share: 2000,
    categoryId: "food",
    date: "2026-11-04",
    note: "",
    receipt: { id: "gone", name: "dinner.pdf", mime: "application/pdf", uri: "/api/receipts/gone" },
  };
  const server = await mockApi(context, [hidden]);
  await open(page);
  await page.getByRole("region", { name: "Search results" }).getByRole("button", { name: /Shared dinner/ }).click();
  await page.getByRole("dialog", { name: "Shared dinner" }).getByRole("button", { name: "Open receipt dinner.pdf" }).click();
  const preview = page.getByRole("dialog", { name: "dinner.pdf" });
  await expect(preview.getByRole("alert")).toContainText("This receipt isn't available");
  await expect(preview.getByRole("button", { name: "Download" })).toHaveCount(0);
  await preview.getByRole("button", { name: "Close" }).click();

  server.expired = true;
  await page.getByRole("dialog", { name: "Shared dinner" }).getByRole("button", { name: "Open receipt dinner.pdf" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Your session ended" })).toBeVisible();
  expect(unexpected(errors)).toEqual([]);
});
