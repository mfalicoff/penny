import { describe, expect, it, vi } from "vitest";
import { handleEmail, recipientFetcher, REJECT_LIMIT, REJECT_SIZE, REJECT_UNKNOWN, type Env } from "../src/handler.ts";
import { base64Bytes, sha256Hex } from "../src/crypto.ts";
import { RecipientList, RecipientListUnavailable } from "../src/recipients.ts";
import { sign } from "../src/signature.ts";
import { SECRET } from "./signature.test.ts";

const LOCAL = "r-abcdefghijklmnopqrst";
const NOW = 1_763_300_000_000;
const RAW = new TextEncoder().encode("From: shop@example.test\r\nSubject: Receipt\r\n\r\nThanks!\r\n");

const env: Env = {
  PENNY_ORIGIN: "https://penny-inbound.example.test",
  RECEIPT_DOMAIN: "receipts.example.test",
  MAX_MESSAGE_BYTES: "1024",
  PENNY_WEBHOOK_SECRET: SECRET,
};

function message(to = `${LOCAL}@receipts.example.test`, raw: Uint8Array = RAW, rawSize = raw.byteLength) {
  const read = vi.fn();
  return {
    to,
    rawSize,
    get raw() {
      read();
      return new Response(raw).body!;
    },
    setReject: vi.fn(),
    read,
  };
}

// A fake Penny: the recipient list holds LOCAL, and the message endpoint answers `status`.
async function penny(status = 202, live = [LOCAL], config: Env = env) {
  const hashes = await Promise.all(live.map((local) => sha256Hex(local)));
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input.toString());
    if (url.pathname === "/api/inbound-mail/recipients")
      return Response.json({ version: "v1", generatedAt: NOW, hashes }, { status: 200 });
    return new Response(JSON.stringify(init?.method), { status });
  });
  const now = () => NOW;
  const recipients = new RecipientList({ ttlMs: 60_000, now, fetchList: recipientFetcher(config, { fetch, now }) });
  return { fetch, deps: { fetch, now, recipients } };
}

const posts = (fetch: ReturnType<typeof vi.fn>) =>
  fetch.mock.calls.filter(([input]) => new URL(String(input)).pathname === "/api/inbound-mail");

describe("handleEmail", () => {
  it("forwards a live recipient's raw message, signed", async () => {
    const { fetch, deps } = await penny();
    const mail = message(`R-ABCDEFGHIJKLMNOPQRST+shop@Receipts.Example.Test`);
    await handleEmail(mail, env, deps);
    expect(mail.setReject).not.toHaveBeenCalled();
    const [[input, init]] = posts(fetch) as [[URL, RequestInit]];
    expect(input.toString()).toBe("https://penny-inbound.example.test/api/inbound-mail");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Penny-Recipient"]).toBe(LOCAL);
    expect(headers["X-Penny-Timestamp"]).toBe("1763300000");
    expect(headers["Content-Type"]).toBe("message/rfc822");
    expect(new Uint8Array(init.body as ArrayBuffer)).toEqual(RAW);
    expect(headers["X-Penny-Signature"]).toBe(await sign(base64Bytes(SECRET), "message", "1763300000", LOCAL, RAW));
    expect(headers["CF-Access-Client-Id"]).toBeUndefined();
  });

  it("signs the recipient list request with its own purpose", async () => {
    const { fetch, deps } = await penny();
    await handleEmail(message(), env, deps);
    const [input, init] = fetch.mock.calls[0] as [URL, RequestInit];
    expect(input.toString()).toBe("https://penny-inbound.example.test/api/inbound-mail/recipients");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Penny-Signature"]).toBe(
      await sign(base64Bytes(SECRET), "recipients", "1763300000", "/api/inbound-mail/recipients", new Uint8Array()),
    );
  });

  it.each([
    "postmaster@receipts.example.test",
    `${LOCAL}@other.example.test`,
    "r-short@receipts.example.test",
  ])("rejects %s without calling Penny", async (to) => {
    const { fetch, deps } = await penny();
    const mail = message(to);
    await handleEmail(mail, env, deps);
    expect(mail.setReject).toHaveBeenCalledWith(REJECT_UNKNOWN);
    expect(fetch).not.toHaveBeenCalled();
    expect(mail.read).not.toHaveBeenCalled();
  });

  it("rejects a well-formed address missing from the list without posting the message", async () => {
    const { fetch, deps } = await penny(202, []);
    const mail = message();
    await handleEmail(mail, env, deps);
    expect(mail.setReject).toHaveBeenCalledWith(REJECT_UNKNOWN);
    expect(posts(fetch)).toHaveLength(0);
    expect(mail.read).not.toHaveBeenCalled();
  });

  it("rejects an oversized message from its declared size before reading it", async () => {
    const { fetch, deps } = await penny();
    const mail = message(undefined, RAW, 1025);
    await handleEmail(mail, env, deps);
    expect(mail.setReject).toHaveBeenCalledWith(REJECT_SIZE);
    expect(mail.read).not.toHaveBeenCalled();
    expect(posts(fetch)).toHaveLength(0);
  });

  it.each([
    [404, REJECT_UNKNOWN],
    [413, REJECT_SIZE],
    [429, REJECT_LIMIT],
  ])("turns Penny's %i into an SMTP reject", async (status, reason) => {
    const { deps } = await penny(status);
    const mail = message();
    await handleEmail(mail, env, deps);
    expect(mail.setReject).toHaveBeenCalledWith(reason);
  });

  it.each([401, 500, 503, 302])("throws on Penny's %i so the sender retries", async (status) => {
    const { deps } = await penny(status);
    const mail = message();
    await expect(handleEmail(mail, env, deps)).rejects.toThrow(`Penny returned ${status}`);
    expect(mail.setReject).not.toHaveBeenCalled();
  });

  it("throws, never forwards, when the recipient list is unavailable", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 401 }));
    const now = () => NOW;
    const recipients = new RecipientList({ ttlMs: 60_000, now, fetchList: recipientFetcher(env, { fetch, now }) });
    const mail = message();
    await expect(handleEmail(mail, env, { fetch, now, recipients })).rejects.toBeInstanceOf(RecipientListUnavailable);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mail.setReject).not.toHaveBeenCalled();
  });

  it("refuses a malformed recipient list", async () => {
    const fetch = vi.fn(async () => Response.json({ version: "v1", hashes: ["<script>"] }));
    await expect(recipientFetcher(env, { fetch, now: () => NOW })(undefined)).rejects.toThrow();
  });

  it("sends Cloudflare Access service-token headers when configured", async () => {
    const access = { ...env, CF_ACCESS_CLIENT_ID: "id.access", CF_ACCESS_CLIENT_SECRET: "secret" };
    const { fetch, deps } = await penny(202, [LOCAL], access);
    await handleEmail(message(), access, deps);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [, init] of fetch.mock.calls as Array<[URL, RequestInit]>) {
      const headers = init.headers as Record<string, string>;
      expect(headers["CF-Access-Client-Id"]).toBe("id.access");
      expect(headers["CF-Access-Client-Secret"]).toBe("secret");
    }
  });

  it("logs only outcome codes, never the address or content", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { deps } = await penny();
    await handleEmail(message(), env, deps);
    await handleEmail(message("postmaster@receipts.example.test"), env, deps);
    const lines = log.mock.calls.map((call) => call.join(" "));
    log.mockRestore();
    expect(lines).toEqual(['{"outcome":"forwarded","status":202}', '{"outcome":"rejected_address"}']);
  });
});

describe("entry module", () => {
  // workerd refuses to start when the main module has named exports that aren't handlers.
  it("exports only the default handler", async () => {
    const entry = await import("../src/index.ts");
    expect(Object.keys(entry)).toEqual(["default"]);
  });
});
