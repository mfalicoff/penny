import { z } from "zod";

/**
 * Zod models for the DTOs the web app consumes. They mirror `contracts/openapi.json`;
 * `src/api/schemas.contract.test.ts` fails when a model's fields, requirements or enums
 * drift from that file, so the contract stays the single source of truth.
 */

const id = z.string().min(1).max(100);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cents = z.number().int().min(0).max(99_999_999_999);
export const kindSchema = z.enum(["income", "expense", "investment"]);

export const errorSchema = z.object({ error: z.string() });
export const okSchema = z.object({ ok: z.boolean() });

/** `POST /api/auth/login` and `/register` body. */
export const credentialsSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(10).max(256),
});

/**
 * `POST /api/auth/login`, `/register` and `/oidc/complete` response. The `token` is also
 * returned for native clients. The browser ignores it and relies on the HttpOnly cookie,
 * so callers must never put it in state or storage.
 */
// The token is validated only as non-empty: the browser discards it, so a format change there
// must not fail a sign-in the server already completed.
export const sessionSchema = z.object({ token: z.string().min(1), email: z.email() });
export const meSchema = z.object({ email: z.email() });

export const oidcConfigSchema = z.object({ enabled: z.boolean(), label: z.string().optional() });
export const oidcStartSchema = z.object({ redirectUri: z.url() });
/** The browser navigates to this address, so only https (and http on loopback, for local providers) is allowed. */
export function isSafeAuthorizationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

export const oidcChallengeSchema = z.object({
  transaction: z.string().regex(/^[a-f0-9]{64}$/),
  authorizationUrl: z.url().refine(isSafeAuthorizationUrl, "The sign-in provider address must use https."),
  expiresAt: z.number().int(),
});
export const oidcCompleteSchema = z.object({
  transaction: z.string().regex(/^[a-f0-9]{64}$/),
  callbackUrl: z.string().max(8192),
});

export const receiptSchema = z.object({
  id,
  name: z.string().max(255),
  mime: z.string().max(100),
  uri: z.string().max(500),
});

export const entrySchema = z.object({
  id,
  title: z.string().min(1).max(100),
  kind: kindSchema,
  total: z.number().int().min(1).max(99_999_999_999),
  share: cents,
  categoryId: id,
  accountId: id.optional(),
  tripId: id.optional(),
  date: isoDate,
  note: z.string().max(1000),
  receipt: receiptSchema.optional(),
  recurringId: id.optional(),
});

export const projectedExpenseSchema = z.object({
  id,
  householdId: id,
  householdName: z.string().optional(),
  householdCurrency: z.enum(["CAD", "USD", "EUR", "GBP"]).optional(),
  title: z.string(),
  date: isoDate,
  totalCents: z.number().int().min(1).max(99_999_999_999),
  shareCents: cents,
  payerUserId: id,
  category: z.object({
    name: z.string().min(1).max(50),
    icon: z.string().max(80),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  }),
  note: z.string(),
  receipt: receiptSchema.optional(),
  accountId: id.optional(),
  scheduled: z.boolean().optional(),
  recurringId: id.optional(),
  receiptId: id.optional(),
});

/** `POST /api/v1/search/transactions` request (MAZ-121). The server rejects unknown fields. */
export const searchRequestSchema = z.object({
  query: z.string().max(200).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  kind: kindSchema.optional(),
  source: z.enum(["personal", "shared", "all"]).optional(),
  sort: z.enum(["relevance", "date-desc", "date-asc", "amount-desc", "amount-asc"]).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(2048).optional(),
});
export type SearchRequest = z.infer<typeof searchRequestSchema>;

const matchSchema = z.enum(["title", "text", "typo", "meaning"]).nullable();
export const searchItemSchema = z.discriminatedUnion("source", [
  z.object({ key: z.string().regex(/^personal:.+/), source: z.literal("personal"), match: matchSchema, entry: entrySchema }),
  z.object({ key: z.string().regex(/^shared:.+/), source: z.literal("shared"), match: matchSchema, entry: projectedExpenseSchema }),
]);
export type SearchItem = z.infer<typeof searchItemSchema>;

export const searchResponseSchema = z.object({
  version: z.literal(1),
  items: z.array(searchItemSchema).max(100),
  totalCount: z.number().int().min(0),
  nextCursor: z.string().max(2048).nullable(),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;
