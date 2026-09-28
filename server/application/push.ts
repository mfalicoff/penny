import { z } from "zod";
import { ApplicationError } from "./errors.ts";
import type { Session } from "./ports.ts";

export type PushPayload = { householdId: string; month: string; expenseId?: string; eventId: string };
export type PushDispatch = {
  outboxId: string;
  token: string;
  eventType: string;
  payload: string;
  attempts: number;
};
export type PushReceiptCandidate = {
  outboxId: string;
  token: string;
  ticketId: string;
  sentAt: number;
  attempts: number;
};

export interface PushRepository {
  registerDevice(session: Session, token: string, platform: "ios" | "android", now: number): void;
  removeDevice(session: Session, token: string, now: number): void;
  claimDue(now: number, limit: number): PushDispatch[];
  markAccepted(item: PushDispatch, ticketId: string, now: number): void;
  markRetry(item: PushDispatch, nextAttemptAt: number, error: string): void;
  markPermanent(item: PushDispatch, now: number, error: string): void;
  removeInvalidToken(token: string, now: number): void;
  claimReceipts(now: number, limit: number): PushReceiptCandidate[];
  markReceiptChecked(item: PushReceiptCandidate, now: number): void;
  retryReceipt(item: PushReceiptCandidate, nextAttemptAt: number): void;
}

const device = z.object({
  token: z.string().regex(/^(?:Expo|Exponent)PushToken\[[A-Za-z0-9_-]{1,180}\]$/),
  platform: z.enum(["ios", "android"]),
});
const removal = device.pick({ token: true });
const payload = z.object({
  householdId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  expenseId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional(),
  eventId: z.string().min(1).max(100),
});

type ExpoTicket = { status: "ok"; id: string } | {
  status: "error"; message?: string; details?: { error?: string };
};
type ExpoReceipt = { status: "ok" } | {
  status: "error"; message?: string; details?: { error?: string };
};
type Http = typeof fetch;

class ExpoHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Expo Push Service returned HTTP ${status}.`);
    this.status = status;
  }
}

const SEND_URL = "https://exp.host/--/api/v2/push/send";
const RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const RETRY_BASE_MS = 5000;
const RETRY_MAX_MS = 60 * 60 * 1000;
const RECEIPT_DELAY_MS = 15 * 60 * 1000;
const RECEIPT_EXPIRY_MS = 24 * 60 * 60 * 1000;

export function retryAt(now: number, attempts: number): number {
  return now + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(10, Math.max(0, attempts - 1)));
}

function messageFor(eventType: string): { title: string; body: string } {
  switch (eventType) {
    case "expense.created": return { title: "New household expense", body: "A member added an expense. Open Penny to see your share." };
    case "expense.updated": return { title: "Household expense updated", body: "A shared expense changed. Open Penny to review it." };
    case "reimbursement.created": return { title: "Reimbursement recorded", body: "A household reimbursement was recorded." };
    default: throw new Error("Unknown household push event.");
  }
}

async function postJson(http: Http, url: string, body: unknown): Promise<unknown> {
  const response = await http(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new ExpoHttpError(response.status);
  return response.json();
}

function parsePayload(item: PushDispatch): PushPayload {
  return payload.parse(JSON.parse(item.payload));
}

/** The sender is intentionally single-flight; the repository leases claimed deliveries across processes. */
export function createPushService(repository: PushRepository, http: Http = fetch, now: () => number = Date.now) {
  let sending = false;
  let checkingReceipts = false;
  return {
    register(session: Session, body: unknown) {
      const result = device.safeParse(body);
      if (!result.success) throw new ApplicationError("invalid", "Invalid push device.");
      repository.registerDevice(session, result.data.token, result.data.platform, now());
      return { ok: true };
    },
    remove(session: Session, body: unknown) {
      const result = removal.safeParse(body);
      if (!result.success) throw new ApplicationError("invalid", "Invalid push device.");
      repository.removeDevice(session, result.data.token, now());
      return { ok: true };
    },
    async flushDue(limit = 100): Promise<number> {
      if (sending) return 0;
      sending = true;
      try {
        const claimed = repository.claimDue(now(), Math.min(100, Math.max(1, limit)));
        const ready: { item: PushDispatch; message: Record<string, unknown> }[] = [];
        for (const item of claimed) {
          try {
            const data = parsePayload(item);
            const { title, body } = messageFor(item.eventType);
            ready.push({ item, message: { to: item.token, title, body, sound: "default", channelId: "households", data } });
          } catch {
            repository.markPermanent(item, now(), "Invalid household push payload.");
          }
        }
        if (!ready.length) return 0;
        let response: unknown;
        try {
          response = await postJson(http, SEND_URL, ready.map(({ message }) => message));
        } catch (error) {
          const reason = error instanceof Error ? error.message : "Push request failed.";
          const permanent = error instanceof ExpoHttpError && error.status >= 400 && error.status < 500 && error.status !== 429;
          for (const { item } of ready) {
            if (permanent) repository.markPermanent(item, now(), reason);
            else repository.markRetry(item, retryAt(now(), item.attempts), reason);
          }
          return 0;
        }
        const tickets = z.object({ data: z.array(z.unknown()) }).safeParse(response);
        if (!tickets.success || tickets.data.data.length !== ready.length) {
          for (const { item } of ready) repository.markRetry(item, retryAt(now(), item.attempts), "Invalid Expo push ticket response.");
          return 0;
        }
        let accepted = 0;
        for (let i = 0; i < ready.length; i++) {
          const item = ready[i].item;
          const ticket = tickets.data.data[i] as ExpoTicket | null;
          if (ticket?.status === "ok" && typeof ticket.id === "string" && ticket.id) {
            repository.markAccepted(item, ticket.id, now());
            accepted++;
          } else if (ticket?.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
            repository.removeInvalidToken(item.token, now());
          } else if (ticket?.status === "error" && ticket.details?.error === "MessageRateExceeded") {
            repository.markRetry(item, retryAt(now(), item.attempts), ticket.message ?? "Rate exceeded.");
          } else {
            repository.markPermanent(item, now(), ticket?.status === "error" ?
              (ticket.message ?? "Expo rejected the push message.") : "Invalid Expo push ticket.");
          }
        }
        return accepted;
      } finally { sending = false; }
    },
    async checkReceipts(limit = 100): Promise<number> {
      if (checkingReceipts) return 0;
      checkingReceipts = true;
      try {
        const claimed = repository.claimReceipts(now() - RECEIPT_DELAY_MS, Math.min(100, Math.max(1, limit)));
        if (!claimed.length) return 0;
        let response: unknown;
        try {
          response = await postJson(http, RECEIPTS_URL, { ids: claimed.map((item) => item.ticketId) });
        } catch (error) {
          const permanent = error instanceof ExpoHttpError && error.status >= 400 && error.status < 500 && error.status !== 429;
          for (const item of claimed) {
            if (permanent) repository.markReceiptChecked(item, now());
            else repository.retryReceipt(item, retryAt(now(), item.attempts));
          }
          return 0;
        }
        const receipts = z.object({ data: z.record(z.string(), z.unknown()) }).safeParse(response);
        if (!receipts.success) {
          for (const item of claimed) repository.retryReceipt(item, retryAt(now(), item.attempts));
          return 0;
        }
        let checked = 0;
        for (const item of claimed) {
          const receipt = receipts.data.data[item.ticketId] as ExpoReceipt | undefined;
          if (receipt?.status === "ok") {
            repository.markReceiptChecked(item, now());
            checked++;
          } else if (receipt?.status === "error" && receipt.details?.error === "DeviceNotRegistered") {
            repository.removeInvalidToken(item.token, now());
            repository.markReceiptChecked(item, now());
            checked++;
          } else if (receipt?.status === "error" && receipt.details?.error === "MessageRateExceeded" && now() - item.sentAt < RECEIPT_EXPIRY_MS) {
            repository.retryReceipt(item, retryAt(now(), item.attempts));
          } else if (receipt?.status === "error" || now() - item.sentAt >= RECEIPT_EXPIRY_MS) {
            repository.markReceiptChecked(item, now());
            checked++;
          } else {
            repository.retryReceipt(item, retryAt(now(), item.attempts));
          }
        }
        return checked;
      } finally { checkingReceipts = false; }
    },
  };
}

export type PushService = ReturnType<typeof createPushService>;
