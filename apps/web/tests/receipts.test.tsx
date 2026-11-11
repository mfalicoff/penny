import { act, configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkReceiptFile,
  formatBytes,
  matchesSignature,
  MAX_RECEIPT_BYTES,
  RECEIPT_MESSAGES,
  ReceiptFileError,
  receiptMimeOf,
  receiptName,
  uploadReceipt,
} from "../src/api/receipts";
import { ApiError } from "../src/api/client";
import { entry, ledgerServer, personalHit, setOnline } from "./fakes/ledgerServer";
import { createHouseholdServer } from "./fakes/householdServer";
import { ALEX, bodyOf, callsTo, json, renderApp, stubServer } from "./render";

/**
 * Receipt upload, preview and download (MAZ-94) in the real app: the file checks, the upload over
 * XMLHttpRequest (a fake that forwards to the stubbed fetch, with progress), the draft link and the
 * preview dialog. pdf.js can't run in jsdom, so its wrapper is replaced; the real decoding runs in
 * the Playwright suite (e2e/receipts.spec.ts). Synthetic bytes only.
 */

configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 20_000 });

const pdf = vi.hoisted(() => ({
  open: vi.fn(),
  destroy: vi.fn(() => Promise.resolve()),
  render: vi.fn(() => Promise.resolve()),
}));
vi.mock("../src/features/receipts/pdf", async (original) => {
  const actual = await original<typeof import("../src/features/receipts/pdf")>();
  return { ...actual, openPdf: pdf.open };
});

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\nsynthetic\n%%EOF\n");
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const file = (bytes: BlobPart, name: string, type: string) => new File([bytes], name, { type });

/** XMLHttpRequest over the stubbed fetch, so uploads are recorded with every other request. */
class FakeXhr {
  static gate: Promise<void> | null = null;
  static sent: FakeXhr[] = [];
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  status = 0;
  responseText = "";
  method = "";
  url = "";
  headers: Record<string, string> = {};
  aborted = false;
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: string) {
    FakeXhr.sent.push(this);
    void (async () => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: body.length / 2, total: body.length });
      if (FakeXhr.gate) await FakeXhr.gate;
      if (this.aborted) return;
      try {
        const response = await fetch(this.url, { method: this.method, body, headers: this.headers });
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- abort() may run while fetch is pending.
        if (this.aborted) return;
        this.upload.onprogress?.({ lengthComputable: true, loaded: body.length, total: body.length });
        this.status = response.status;
        this.responseText = await response.text();
        this.onload?.();
      } catch {
        this.onerror?.();
      }
    })();
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
}

let objectUrls: string[] = [];
let revoked: string[] = [];

beforeEach(() => {
  FakeXhr.gate = null;
  FakeXhr.sent = [];
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  objectUrls = [];
  revoked = [];
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:test/${String(objectUrls.length + 1)}`;
    objectUrls.push(url);
    return url;
  });
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  });
  pdf.open.mockReset();
  pdf.destroy.mockClear();
  pdf.render.mockClear();
  pdf.open.mockResolvedValue({ pageCount: 3, render: pdf.render, destroy: pdf.destroy });
});

afterEach(() => {
  setOnline(true);
});

describe("receipt file checks", () => {
  it("knows the server's types from the browser type or the extension", () => {
    expect(receiptMimeOf({ name: "a.PDF", type: "" })).toBe("application/pdf");
    expect(receiptMimeOf({ name: "photo.heic", type: "" })).toBe("image/heic");
    expect(receiptMimeOf({ name: "photo.heif", type: "application/octet-stream" })).toBe("image/heif");
    expect(receiptMimeOf({ name: "x.bin", type: "image/webp" })).toBe("image/webp");
    expect(receiptMimeOf({ name: "drawing.svg", type: "image/svg+xml" })).toBeNull();
    expect(receiptMimeOf({ name: "notes.pdf", type: "text/plain" })).toBeNull();
    expect(receiptMimeOf({ name: "noextension", type: "" })).toBeNull();
  });

  it("checks each signature like ReceiptFormat.IsAcceptable", () => {
    const bytes = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0));
    expect(matchesSignature("application/pdf", bytes("%PDF-1.7"))).toBe(true);
    expect(matchesSignature("application/pdf", bytes("%PDF"))).toBe(false);
    expect(matchesSignature("image/jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(matchesSignature("image/png", PNG_BYTES)).toBe(true);
    expect(matchesSignature("image/gif", bytes("GIF89a"))).toBe(true);
    expect(matchesSignature("image/gif", bytes("GIF90a"))).toBe(false);
    expect(matchesSignature("image/webp", bytes("RIFF\0\0\0\0WEBP"))).toBe(true);
    expect(matchesSignature("image/webp", bytes("RIFF\0\0\0\0WEB"))).toBe(false);
    expect(matchesSignature("image/heic", bytes("\0\0\0\x18ftypheic"))).toBe(true);
    expect(matchesSignature("image/heif", bytes("\0\0\0\x18ftap"))).toBe(false);
  });

  it("refuses empty, oversized, unsupported and mislabelled files with words, and accepts the limit", async () => {
    const refusal = (candidate: File) => checkReceiptFile(candidate).then(() => null, (error: unknown) => (error instanceof ReceiptFileError ? error.message : String(error)));
    expect(await refusal(file("", "empty.pdf", "application/pdf"))).toBe(RECEIPT_MESSAGES.empty);
    expect(await refusal(file(new Uint8Array(MAX_RECEIPT_BYTES + 1), "big.pdf", "application/pdf"))).toBe(RECEIPT_MESSAGES.tooLarge);
    expect(await refusal(file("text", "notes.txt", "text/plain"))).toBe(RECEIPT_MESSAGES.unsupported);
    expect(await refusal(file(PNG_BYTES, "renamed.pdf", "application/pdf"))).toBe(RECEIPT_MESSAGES.mismatch);
    const limit = new Uint8Array(MAX_RECEIPT_BYTES);
    limit.set(PDF_BYTES);
    expect(await checkReceiptFile(file(limit, "limit.pdf", "application/pdf"))).toBe("application/pdf");
  });

  it("keeps names within 255 characters with their extension, and formats sizes", () => {
    const long = `${"a".repeat(300)}.pdf`;
    expect(receiptName(long)).toHaveLength(255);
    expect(receiptName(long).endsWith(".pdf")).toBe(true);
    expect(receiptName("  ")).toBe("receipt");
    expect([formatBytes(900), formatBytes(2048), formatBytes(1.5 * 1024 * 1024)]).toEqual(["900 B", "2 KB", "1.5 MB"]);
  });
});

describe("uploadReceipt", () => {
  it("sends the file as base64 JSON with progress and returns the link", async () => {
    const fetchMock = ledgerServer().fetchMock;
    fetchMock.mockImplementationOnce(() => Promise.resolve(json({ id: "r1", name: "receipt.pdf", mime: "application/pdf", uri: "/api/receipts/r1" }, 201)));
    const progress: number[] = [];
    const receipt = await uploadReceipt(file(PDF_BYTES, "receipt.pdf", "application/pdf"), "application/pdf", { signal: new AbortController().signal, onProgress: (value) => progress.push(value) });
    expect(receipt).toEqual({ id: "r1", name: "receipt.pdf", mime: "application/pdf", uri: "/api/receipts/r1" });
    expect(bodyOf(callsTo(fetchMock, "/api/receipts")[0])).toEqual({ name: "receipt.pdf", mime: "application/pdf", base64: btoa(String.fromCharCode(...PDF_BYTES)) });
    expect(progress).toEqual([0, 0.5, 1]);
  });

  it("reports the server's refusal, an ended session and a cancel distinctly", async () => {
    const fetchMock = ledgerServer().fetchMock;
    const upload = (signal = new AbortController().signal) => uploadReceipt(file(PDF_BYTES, "r.pdf", "application/pdf"), "application/pdf", { signal });
    fetchMock.mockImplementationOnce(() => Promise.resolve(json({ error: "This file is not a supported photo or PDF, or exceeds 10 MB." }, 400)));
    await expect(upload()).rejects.toMatchObject({ status: 400, message: "This file is not a supported photo or PDF, or exceeds 10 MB." });
    fetchMock.mockImplementationOnce(() => Promise.resolve(json({ error: "Please sign in to continue." }, 401)));
    await expect(upload()).rejects.toMatchObject({ status: 401, message: RECEIPT_MESSAGES.expired });
    fetchMock.mockImplementationOnce(() => Promise.resolve(json({ error: "The server could not complete this request." }, 500)));
    await expect(upload()).rejects.toEqual(new ApiError(500, RECEIPT_MESSAGES.failed));
    fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(upload()).rejects.toMatchObject({ status: 0, message: RECEIPT_MESSAGES.offline });

    FakeXhr.gate = new Promise(() => undefined);
    const controller = new AbortController();
    const pending = upload(controller.signal);
    await waitFor(() => {
      expect(FakeXhr.sent).toHaveLength(5);
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

const PDF_RECEIPT = { id: "r1", name: "dinner.pdf", mime: "application/pdf", uri: "/api/receipts/r1" };
const dinner = () => ({ ...entry("e1", "Dinner"), receipt: PDF_RECEIPT });
const market = { ...entry("e1", "Market"), receipt: { id: "r2", name: "market.png", mime: "image/png", uri: "/api/receipts/r2" } };

/** The ledger fake plus a receipt store: uploads get ids r1, r2, …; `hidden` ids answer 404. */
function receiptServer(initial: Parameters<typeof ledgerServer>[0] = {}) {
  // Activity lists what search returns: every entry, as personal hits.
  const server = ledgerServer(initial, { search: () => (initial.transactions ?? []).map(personalHit) });
  const files = new Map<string, { mime: string; bytes: Uint8Array<ArrayBuffer> }>([["r1", { mime: "application/pdf", bytes: PDF_BYTES }]]);
  const hidden = new Set<string>();
  const base = server.fetchMock.getMockImplementation();
  server.fetchMock.mockImplementation((input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "/api/receipts" && init?.method === "POST") {
      const body = bodyOf(init) as { name: string; mime: string; base64: string };
      const id = `r${String(files.size + 1)}`;
      files.set(id, { mime: body.mime, bytes: Uint8Array.from(atob(body.base64), (character) => character.charCodeAt(0)) });
      return Promise.resolve(json({ id, name: body.name, mime: body.mime, uri: `/api/receipts/${id}` }, 201));
    }
    const match = /^\/api\/receipts\/(\w+)$/.exec(url);
    if (match) {
      const stored = files.get(match[1] ?? "");
      if (!stored || hidden.has(match[1] ?? "")) return Promise.resolve(json({ error: "Receipt not found." }, 404));
      return Promise.resolve(new Response(stored.bytes, { status: 200, headers: { "Content-Type": stored.mime } }));
    }
    return base ? base(input, init) : Promise.resolve(json({ error: "Not found." }, 404));
  });
  return { ...server, files, hidden };
}

async function openAdd(user: UserEvent) {
  await screen.findByRole("heading", { level: 1 });
  await user.keyboard("n");
  const form = await screen.findByRole("form", { name: "Add entry" });
  await user.type(within(form).getByLabelText("Amount (CAD)"), "40");
  await user.type(within(form).getByLabelText("Title"), "Dinner");
  await user.click(within(form).getByRole("button", { name: /More details/ }));
  return form;
}
const receiptGroup = (form: HTMLElement) => within(form).getByRole("group", { name: "Receipt" });
const attach = (user: UserEvent, form: HTMLElement, candidate: File) => user.upload(within(form).getByLabelText("Receipt file"), candidate);

describe("receipts in the entry form", () => {
  it("uploads a PDF into the draft, keeps it through Keep draft, and saves the link with the entry", async () => {
    const server = receiptServer();
    const user = userEvent.setup({ applyAccept: false });
    renderApp("/transactions");
    let form = await openAdd(user);
    await attach(user, form, file(PDF_BYTES, "dinner.pdf", "application/pdf"));
    expect(await within(receiptGroup(form)).findByText("dinner.pdf")).toBeInTheDocument();
    expect(receiptGroup(form)).toHaveTextContent(`PDF · ${formatBytes(PDF_BYTES.length)}`);
    expect(within(receiptGroup(form)).getByText("dinner.pdf attached. It's saved with the entry when you press Save.")).toBeInTheDocument();
    await user.click(within(screen.getByRole("dialog", { name: "Add entry" })).getByRole("button", { name: "Keep draft" }));

    form = await (async () => {
      await user.keyboard("n");
      return screen.findByRole("form", { name: "Add entry" });
    })();
    expect(within(form).getByText("Your unsaved draft is back. Save it, or discard it to start over.")).toBeInTheDocument();
    expect(within(receiptGroup(form)).getByText("dinner.pdf")).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: /More details/ })).toHaveTextContent("Receipt");
    await user.click(within(screen.getByRole("dialog", { name: "Add entry" })).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(server.state.ledger.transactions.find((item) => item.title === "Dinner")).toMatchObject({ receipt: { id: "r2", name: "dinner.pdf", mime: "application/pdf", uri: "/api/receipts/r2" } });
    });
  });

  it("refuses a bad file without uploading, and returns focus to Photo on Dismiss", async () => {
    const server = receiptServer();
    const user = userEvent.setup({ applyAccept: false });
    renderApp("/transactions");
    const form = await openAdd(user);
    await attach(user, form, file("text", "notes.txt", "text/plain"));
    expect(await within(receiptGroup(form)).findByRole("alert")).toHaveTextContent(RECEIPT_MESSAGES.unsupported);
    expect(within(receiptGroup(form)).queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    await user.click(within(receiptGroup(form)).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => {
      expect(within(receiptGroup(form)).getByRole("button", { name: "Attach a photo" })).toHaveFocus();
    });
    expect(callsTo(server.fetchMock, "/api/receipts")).toHaveLength(0);
  });

  it("holds Save while uploading, cancels on request, and cancels when the form closes", async () => {
    const server = receiptServer();
    const user = userEvent.setup({ applyAccept: false });
    renderApp("/transactions");
    const form = await openAdd(user);
    FakeXhr.gate = new Promise(() => undefined);
    await attach(user, form, file(PDF_BYTES, "slow.pdf", "application/pdf"));
    const bar = await within(receiptGroup(form)).findByRole("progressbar", { name: "Uploading slow.pdf" });
    expect(bar).toHaveAttribute("value", "0.5");
    await user.click(within(screen.getByRole("dialog", { name: "Add entry" })).getByRole("button", { name: "Save" }));
    expect(await within(form).findByText("The receipt is still uploading. Wait for it to finish, or cancel the upload.", { exact: false })).toBeInTheDocument();
    expect(server.state.puts).toBe(0);
    await user.click(within(receiptGroup(form)).getByRole("button", { name: "Cancel upload" }));
    expect(FakeXhr.sent[0]?.aborted).toBe(true);
    expect(within(receiptGroup(form)).queryByRole("progressbar")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(within(receiptGroup(form)).getByRole("button", { name: "Attach a photo" })).toHaveFocus();
    });

    await attach(user, form, file(PDF_BYTES, "again.pdf", "application/pdf"));
    await within(receiptGroup(form)).findByRole("progressbar");
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Add entry" })).not.toBeInTheDocument();
    });
    expect(FakeXhr.sent[1]?.aborted).toBe(true);
  });

  it("offers Try again after a server failure and attaches on the retry", async () => {
    const server = receiptServer();
    const user = userEvent.setup({ applyAccept: false });
    renderApp("/transactions");
    const form = await openAdd(user);
    const implementation = server.fetchMock.getMockImplementation();
    server.fetchMock.mockImplementationOnce(() => Promise.resolve(json({ error: "The server could not complete this request." }, 500)));
    await attach(user, form, file(PNG_BYTES, "photo.png", "image/png"));
    expect(await within(receiptGroup(form)).findByRole("alert")).toHaveTextContent("The upload didn't finish. Try again.");
    if (implementation) server.fetchMock.mockImplementation(implementation);
    await user.click(within(receiptGroup(form)).getByRole("button", { name: "Try again" }));
    expect(await within(receiptGroup(form)).findByText("photo.png")).toBeInTheDocument();
    expect(receiptGroup(form)).toHaveTextContent("Photo");
  });

  it("can't upload offline and says the rest of the entry still saves", async () => {
    receiptServer();
    const user = userEvent.setup({ applyAccept: false });
    renderApp("/transactions");
    const form = await openAdd(user);
    setOnline(false);
    expect(receiptGroup(form)).toHaveAccessibleDescription(/Connect to the internet to attach a receipt/);
    expect(within(receiptGroup(form)).getByRole("button", { name: "Attach a photo" })).toHaveAttribute("aria-disabled", "true");
  });

  it("removes an existing receipt from an edit and saves without it", async () => {
    const server = receiptServer({ transactions: [dinner()] });
    const user = userEvent.setup();
    renderApp("/transactions");
    await user.click(await screen.findByRole("button", { name: /Dinner/ }));
    await user.click(within(await screen.findByRole("dialog", { name: "Dinner" })).getByRole("button", { name: "Edit" }));
    const form = await screen.findByRole("form", { name: "Edit entry" });
    await user.click(within(receiptGroup(form)).getByRole("button", { name: "Remove dinner.pdf" }));
    await user.click(within(screen.getByRole("dialog", { name: "Edit entry" })).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(server.state.puts).toBe(1);
    });
    expect(server.state.ledger.transactions[0]).not.toHaveProperty("receipt");
  });
});

describe("receipt preview", () => {
  it("shows PDF pages, pages through them, downloads the bytes, and cleans up on close", async () => {
    receiptServer({ transactions: [dinner()] });
    const user = userEvent.setup();
    renderApp("/transactions");
    await user.click(await screen.findByRole("button", { name: /Dinner/ }));
    const opener = within(await screen.findByRole("dialog", { name: "Dinner" })).getByRole("button", { name: "Open receipt dinner.pdf" });
    await user.click(opener);
    const preview = await screen.findByRole("dialog", { name: "dinner.pdf" });
    expect(await within(preview).findByRole("img", { name: "Page 1 of 3, dinner.pdf" })).toBeInTheDocument();
    expect(new TextDecoder().decode(pdf.open.mock.calls[0]?.[0] as Uint8Array)).toBe(new TextDecoder().decode(PDF_BYTES));
    await waitFor(() => {
      expect(pdf.render).toHaveBeenCalledWith(1, expect.any(HTMLCanvasElement), expect.any(Number), expect.any(AbortSignal));
    });
    expect(within(preview).getByRole("button", { name: "Previous page" })).toHaveAttribute("aria-disabled", "true");
    await user.click(within(preview).getByRole("button", { name: "Next page" }));
    expect(within(preview).getByRole("status")).toHaveTextContent("Page 2 of 3");
    await waitFor(() => {
      expect(pdf.render).toHaveBeenCalledWith(2, expect.any(HTMLCanvasElement), expect.any(Number), expect.any(AbortSignal));
    });

    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    await user.click(within(preview).getByRole("button", { name: "Download" }));
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.download).toBe("dinner.pdf");
    expect(link.href).toBe(objectUrls[0]);
    await act(() => new Promise((resolve) => setTimeout(resolve, 1100)));
    expect(revoked).toContain(objectUrls[0]);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "dinner.pdf" })).not.toBeInTheDocument();
    expect(pdf.destroy).toHaveBeenCalled();
    expect(opener).toHaveFocus();
  });

  it("shows a photo from a blob URL and revokes it when closed", async () => {
    const server = receiptServer({ transactions: [market] });
    server.files.set("r2", { mime: "image/png", bytes: PNG_BYTES });
    const user = userEvent.setup();
    renderApp("/transactions");
    await user.click(await screen.findByRole("button", { name: /Market/ }));
    await user.click(within(await screen.findByRole("dialog", { name: "Market" })).getByRole("button", { name: "Open receipt market.png" }));
    const preview = await screen.findByRole("dialog", { name: "market.png" });
    const image = await within(preview).findByRole("img", { name: "Receipt photo: market.png" });
    expect(image).toHaveAttribute("src", objectUrls[0]);
    // A format the browser can't decode (HEIC outside Safari) says so and keeps Download.
    fireEvent.error(image);
    expect(await within(preview).findByRole("alert")).toHaveTextContent("This browser can't display this photo format.");
    expect(within(preview).getByRole("button", { name: "Download" })).toBeInTheDocument();
    await user.click(within(preview).getByRole("button", { name: "Close" }));
    expect(revoked).toContain(objectUrls[0]);
  });

  it("says a damaged PDF can't be shown but keeps Download", async () => {
    receiptServer({ transactions: [dinner()] });
    const { PdfUnreadableError } = await import("../src/features/receipts/pdf");
    pdf.open.mockRejectedValueOnce(new PdfUnreadableError());
    const user = userEvent.setup();
    renderApp("/transactions");
    await user.click(await screen.findByRole("button", { name: /Dinner/ }));
    await user.click(within(await screen.findByRole("dialog", { name: "Dinner" })).getByRole("button", { name: "Open receipt dinner.pdf" }));
    const preview = await screen.findByRole("dialog", { name: "dinner.pdf" });
    expect(await within(preview).findByRole("alert")).toHaveTextContent("This PDF can't be shown");
    expect(within(preview).getByRole("button", { name: "Download" })).toBeInTheDocument();
  });

  it("answers a receipt this account can't read with not-available, and no bytes", async () => {
    const server = receiptServer({ transactions: [dinner()] });
    server.hidden.add("r1");
    const user = userEvent.setup();
    renderApp("/transactions");
    await user.click(await screen.findByRole("button", { name: /Dinner/ }));
    await user.click(within(await screen.findByRole("dialog", { name: "Dinner" })).getByRole("button", { name: "Open receipt dinner.pdf" }));
    const preview = await screen.findByRole("dialog", { name: "dinner.pdf" });
    expect(await within(preview).findByRole("alert")).toHaveTextContent("This receipt isn't available");
    expect(within(preview).queryByRole("button", { name: "Download" })).not.toBeInTheDocument();
    expect(within(preview).queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(pdf.open).not.toHaveBeenCalled();
  });

  it("returns to sign-in when the session ended", async () => {
    const server = receiptServer({ transactions: [dinner()] });
    const user = userEvent.setup();
    renderApp("/transactions");
    await user.click(await screen.findByRole("button", { name: /Dinner/ }));
    const implementation = server.fetchMock.getMockImplementation();
    server.fetchMock.mockImplementation((input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith("/api/receipts/")) return Promise.resolve(json({ error: "Please sign in to continue." }, 401));
      return implementation ? implementation(input, init) : Promise.resolve(json({}, 404));
    });
    await user.click(within(await screen.findByRole("dialog", { name: "Dinner" })).getByRole("button", { name: "Open receipt dinner.pdf" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Welcome back" })).toBeInTheDocument();
  });
});

describe("receipts on shared expenses", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uploads a receipt into a new shared expense and sends its id", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    const households = createHouseholdServer();
    const created = households.handle(ALEX, "POST", "/api/households", { name: "Maison", currency: "CAD" }).body as { household: { id: string } };
    const id = created.household.id;
    const uploads: unknown[] = [];
    const fetchMock = stubServer((url, init) => {
      if (url === "/api/receipts" && init?.method === "POST") {
        uploads.push(bodyOf(init));
        return json({ id: "rs1", name: "groceries.png", mime: "image/png", uri: "/api/receipts/rs1" }, 201);
      }
      if (!url.startsWith("/api/households") && url !== "/api/ledger") return undefined;
      const result = households.handle(ALEX, init?.method ?? "GET", url, (bodyOf(init) ?? {}) as Record<string, unknown>);
      return json(result.body, result.status);
    });
    const user = userEvent.setup({ applyAccept: false });
    renderApp(`/households/${id}`);
    await user.click(await screen.findByRole("button", { name: "Shared expense" }));
    const form = await screen.findByRole("dialog", { name: "New shared expense" });
    await user.type(within(form).getByLabelText("Title"), "Groceries run");
    await user.type(within(form).getByLabelText(/^Total/), "30");
    const group = within(form).getByRole("group", { name: "Receipt" });
    expect(group).toHaveAccessibleDescription(/Everyone in the household can open it\./);
    await user.upload(within(form).getByLabelText("Receipt file"), file(PNG_BYTES, "groceries.png", "image/png"));
    expect(await within(group).findByText("groceries.png")).toBeInTheDocument();
    expect(uploads).toHaveLength(1);
    await user.click(within(form).getByRole("button", { name: "Add expense" }));
    expect(await screen.findByText("Groceries run added")).toBeInTheDocument();
    const post = callsTo(fetchMock, `/api/households/${id}/expenses`).find((init) => init?.method === "POST");
    expect(bodyOf(post)).toMatchObject({ title: "Groceries run", receiptId: "rs1" });
  });
});
