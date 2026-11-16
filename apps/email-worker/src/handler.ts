import { receiptLocalPart } from "./address.ts";
import { base64Bytes, sha256Hex } from "./crypto.ts";
import { logOutcome } from "./log.ts";
import { RecipientList, RecipientListUnavailable, type ListResponse } from "./recipients.ts";
import { MESSAGE_PATH, RECIPIENTS_PATH, sign, unixSeconds } from "./signature.ts";

// The Email Worker's logic, kept out of the entry module: workerd treats every named
// export of src/index.ts as an entrypoint, so that module exports only the handler.
//
// Cloudflare Email Worker for emailed receipts (MAZ-184, docs/plans/email-receipts.md#1-ingress).
// Deliberately thin: it checks the address shape, the recipient list and the size,
// signs the raw bytes and forwards them to Penny, which does all parsing. Rejections
// happen during the SMTP session (`setReject`); Penny never sends a bounce. A thrown
// error makes Email Routing report a temporary failure, so the sender retries.

export interface Env {
  PENNY_ORIGIN: string;
  RECEIPT_DOMAIN: string;
  MAX_MESSAGE_BYTES: string;
  RECIPIENT_LIST_TTL_SECONDS?: string;
  PENNY_WEBHOOK_SECRET: string;
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
}

export interface Dependencies {
  fetch: typeof fetch;
  now: () => number;
  recipients: RecipientList;
}

// The parts of ForwardableEmailMessage the Worker uses.
export type IncomingEmail = Pick<ForwardableEmailMessage, "to" | "raw" | "rawSize" | "setReject">;

export const REJECT_UNKNOWN = "Unknown address";
export const REJECT_SIZE = "Message too large";
export const REJECT_LIMIT = "Try again later";

export class PennyUnavailable extends Error {
  constructor(readonly status: number) {
    super(`Penny returned ${status}`);
    this.name = "PennyUnavailable";
  }
}

export async function handleEmail(message: IncomingEmail, env: Env, deps: Dependencies): Promise<void> {
  const local = receiptLocalPart(message.to, env.RECEIPT_DOMAIN);
  if (local === null) {
    logOutcome("rejected_address");
    return message.setReject(REJECT_UNKNOWN);
  }
  let live: boolean;
  try {
    live = await deps.recipients.has(await sha256Hex(local));
  } catch (error) {
    if (error instanceof RecipientListUnavailable) logOutcome("retry_list");
    throw error;
  }
  if (!live) {
    logOutcome("rejected_unknown");
    return message.setReject(REJECT_UNKNOWN);
  }
  // Refused from the declared size, before the body is read.
  if (message.rawSize > maxMessageBytes(env)) {
    logOutcome("rejected_size");
    return message.setReject(REJECT_SIZE);
  }

  const body = await new Response(message.raw).arrayBuffer();
  if (body.byteLength > maxMessageBytes(env)) {
    logOutcome("rejected_size");
    return message.setReject(REJECT_SIZE);
  }
  const timestamp = unixSeconds(deps.now());
  const signature = await sign(secret(env), "message", timestamp, local, body);
  const response = await deps.fetch(new URL(MESSAGE_PATH, env.PENNY_ORIGIN), {
    method: "POST",
    redirect: "manual",
    headers: {
      ...accessHeaders(env),
      "Content-Type": "message/rfc822",
      "X-Penny-Recipient": local,
      "X-Penny-Timestamp": timestamp,
      "X-Penny-Signature": signature,
    },
    body,
  });
  await response.body?.cancel();
  switch (response.status) {
    case 202:
      return logOutcome("forwarded", response.status);
    case 404:
      logOutcome("rejected_unknown", response.status);
      return message.setReject(REJECT_UNKNOWN);
    case 413:
      logOutcome("rejected_size", response.status);
      return message.setReject(REJECT_SIZE);
    case 429:
      logOutcome("rejected_limit", response.status);
      return message.setReject(REJECT_LIMIT);
    default:
      logOutcome("retry_penny", response.status);
      throw new PennyUnavailable(response.status);
  }
}

export function recipientFetcher(env: Env, deps: Pick<Dependencies, "fetch" | "now">) {
  return async (version: string | undefined): Promise<ListResponse> => {
    const timestamp = unixSeconds(deps.now());
    const signature = await sign(secret(env), "recipients", timestamp, RECIPIENTS_PATH, new Uint8Array());
    const headers: Record<string, string> = {
      ...accessHeaders(env),
      "X-Penny-Timestamp": timestamp,
      "X-Penny-Signature": signature,
    };
    if (version !== undefined) headers["If-None-Match"] = `"${version}"`;
    const response = await deps.fetch(new URL(RECIPIENTS_PATH, env.PENNY_ORIGIN), {
      method: "GET",
      redirect: "manual",
      headers,
    });
    if (response.status === 304) {
      await response.body?.cancel();
      return { status: "unchanged" };
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new PennyUnavailable(response.status);
    }
    const list = (await response.json()) as { version?: unknown; hashes?: unknown };
    if (
      typeof list.version !== "string" ||
      !Array.isArray(list.hashes) ||
      !list.hashes.every((hash) => typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash))
    ) {
      throw new PennyUnavailable(response.status);
    }
    return { status: "list", version: list.version, hashes: list.hashes as string[] };
  };
}

function maxMessageBytes(env: Env): number {
  const value = Number(env.MAX_MESSAGE_BYTES);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("MAX_MESSAGE_BYTES must be a positive integer.");
  return value;
}

function secret(env: Env): Uint8Array {
  const bytes = base64Bytes(env.PENNY_WEBHOOK_SECRET ?? "");
  if (bytes.length < 32) throw new Error("PENNY_WEBHOOK_SECRET must be base64 of at least 32 bytes.");
  return bytes;
}

// Service-token headers when Penny's hostname sits behind Cloudflare Access.
function accessHeaders(env: Env): Record<string, string> {
  return env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET
    ? { "CF-Access-Client-Id": env.CF_ACCESS_CLIENT_ID, "CF-Access-Client-Secret": env.CF_ACCESS_CLIENT_SECRET }
    : {};
}
