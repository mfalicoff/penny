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
/* ---------- profiles (MAZ-171) ---------- */

/** A display name: trimmed, 1 to 60 UTF-16 units, no control characters. Display only, never identity. */
const displayName = z.string().min(1).max(60);
/** Same-origin `/api/users/<id>/avatar?v=<version>`, loaded with the session cookie. */
const avatarUrl = z.string().regex(/^\/api\/users\/[^/?#]+\/avatar\?v=[0-9a-f]{32}$/);

/**
 * `GET /api/auth/me`: who is signed in, with the profile summary the shell shows. Servers before
 * profiles send only `email`, so the rest is optional.
 */
export const meSchema = z.object({
  email: z.email(),
  userId: id.optional(),
  displayName: displayName.optional(),
  avatarUrl: avatarUrl.optional(),
  needsName: z.boolean().optional(),
});
export type Me = z.infer<typeof meSchema>;

/** `GET`, `PATCH /api/profile`, `PUT` and `DELETE /api/profile/avatar`. */
export const profileSchema = z.object({
  userId: id,
  email: z.email(),
  displayName: displayName.optional(),
  avatarUrl: avatarUrl.optional(),
  // False when the sign-in provider sends the field: read only, refreshed at each sign-in.
  nameEditable: z.boolean(),
  avatarEditable: z.boolean(),
  needsName: z.boolean(),
  signIn: z.enum(["password", "oidc"]),
  // The configured name of the account's own provider; absent: "your sign-in provider".
  provider: z.string().min(1).optional(),
  // When a password account last changed its password (Unix ms); absent before the first change.
  passwordChangedAt: z.number().int().optional(),
  // MAZ-172: whether the current email is proven, and when (Unix ms; absent while unverified).
  // Show the unverified state only while the server sends email.
  emailVerified: z.boolean(),
  emailVerifiedAt: z.number().int().optional(),
});
export type Profile = z.infer<typeof profileSchema>;

/** `POST /api/auth/password` body: a signed-in password change. */
export const passwordChangeSchema = z.object({
  currentPassword: z.string().max(256),
  newPassword: z.string().min(10).max(256),
});
export type PasswordChange = z.infer<typeof passwordChangeSchema>;

/* ---------- password reset (MAZ-124) ---------- */

/** A reset code: 64 lowercase hex characters, from the operator or from the emailed link. */
export const RESET_CODE = /^[a-f0-9]{64}$/;

/** `POST /api/auth/password-reset/request` body: a signed-out request for a reset email. */
export const passwordResetRequestSchema = z.object({ email: z.string().min(3).max(254) });

/** `POST /api/auth/password-reset` body: redeem a reset code. */
export const passwordResetSchema = z.object({ token: z.string().regex(RESET_CODE), password: z.string().min(10).max(256) });
export type PasswordReset = z.infer<typeof passwordResetSchema>;

/* ---------- email verification (MAZ-172) ---------- */

/** `POST /api/auth/email-verification` body: the code from the emailed link (same format as a reset code). */
export const emailVerificationRequestSchema = z.object({ token: z.string().regex(RESET_CODE) });

/** `POST /api/auth/email-verification` answer: the address the link verified. */
export const emailVerifiedSchema = z.object({ email: z.email() });

/** `POST /api/auth/email` body: a signed-in email change, confirmed with the password. */
export const emailChangeSchema = z.object({ email: z.string().min(3).max(254), password: z.string().max(256) });
export type EmailChange = z.infer<typeof emailChangeSchema>;

/** `PATCH /api/profile` body: absent fields change nothing; a null name clears it. */
export const profileUpdateSchema = z.object({
  displayName: z.string().max(1000).nullable().optional(),
  namePromptDismissed: z.literal(true).optional(),
});
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

/** `POST /api/auth/register` body: the credentials and the optional name asked at sign-up. */
export const registrationSchema = credentialsSchema.extend({ displayName: z.string().max(1000).optional() });

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
  householdName: z.string(),
  householdCurrency: z.enum(["CAD", "USD", "EUR", "GBP"]),
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

/* ---------- shared households (server MAZ-56–59, web MAZ-91) ---------- */

const instant = z.number().int();
const householdCurrency = z.enum(["CAD", "USD", "EUR", "GBP"]);
const tzOffset = z.number().int().min(-840).max(720);
const monthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const total = z.number().int().min(1).max(99_999_999_999);
export const splitModeSchema = z.enum(["equal", "exact", "percent"]);
export type SplitMode = z.infer<typeof splitModeSchema>;
export const frequencySchema = z.enum(["weekly", "monthly", "yearly"]);
export type Frequency = z.infer<typeof frequencySchema>;

export const householdSchema = z.object({
  id,
  name: z.string(),
  currency: householdCurrency,
  creatorId: id,
  createdAt: instant,
  memberCount: z.number().int().min(0),
  trip: z.object({ startDate: isoDate, endDate: isoDate }).optional(),
});
export type Household = z.infer<typeof householdSchema>;

export const householdMemberSchema = z.object({
  userId: id,
  email: z.email(),
  joinedAt: instant,
  joinedOn: isoDate.optional(),
  // Absent for current members.
  leftAt: instant.optional(),
  // MAZ-171: absent when the member has none; show the email and initials instead.
  displayName: displayName.optional(),
  avatarUrl: avatarUrl.optional(),
  // MAZ-152: the person deleted their account. Show "Former member", never the placeholder email.
  deleted: z.literal(true).optional(),
});
export type HouseholdMember = z.infer<typeof householdMemberSchema>;

export const householdDetailSchema = z.object({ household: householdSchema, members: z.array(householdMemberSchema) });
export type HouseholdDetail = z.infer<typeof householdDetailSchema>;

export const householdInputSchema = z.object({ name: z.string().min(1).max(80), currency: householdCurrency, timezoneOffsetMinutes: tzOffset.optional() });
export type HouseholdInput = z.infer<typeof householdInputSchema>;
export const joinSchema = z.object({ code: z.string().regex(/^[A-Fa-f0-9]{10}$/), timezoneOffsetMinutes: tzOffset.optional() });
export const inviteSchema = z.object({ code: z.string().regex(/^[A-F0-9]{10}$/), expiresAt: instant });
export type Invite = z.infer<typeof inviteSchema>;

/** Invitations by email (MAZ-124): what the creator sent, newest first. Times are Unix ms. */
export const emailInviteStatusSchema = z.enum(["sending", "waiting", "expired", "joined", "failed"]);
export type EmailInviteStatus = z.infer<typeof emailInviteStatusSchema>;
export const emailInviteInputSchema = z.object({ email: z.string().min(3).max(254) });
export const emailInviteSchema = z.object({
  id,
  email: z.string().min(3).max(254),
  status: emailInviteStatusSchema,
  createdAt: instant,
  sentAt: instant.nullable(),
  expiresAt: instant.nullable(),
});
export type EmailInvite = z.infer<typeof emailInviteSchema>;
export const emailInviteListSchema = z.object({ items: z.array(emailInviteSchema) });

export const sharedCategorySchema = z.object({
  name: z.string().min(1).max(50),
  icon: z.string().max(80),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});
export type SharedCategory = z.infer<typeof sharedCategorySchema>;

const amountAllocation = z.object({ userId: id, amountCents: cents });
const percentAllocation = z.object({ userId: id, percentBasisPoints: z.number().int().min(0).max(10_000) });
export const allocationSchema = z.union([amountAllocation, percentAllocation]);
export type Allocation = z.infer<typeof allocationSchema>;

/** The body shared by expense and rule writes. */
const expenseFields = {
  title: z.string().min(1).max(100),
  totalCents: total,
  payerUserId: id,
  splitMode: splitModeSchema,
  allocations: z.array(allocationSchema).max(100).optional(),
  category: sharedCategorySchema,
  note: z.string().max(1000).default(""),
  accountId: id.optional(),
  receiptId: id.optional(),
  timezoneOffsetMinutes: tzOffset.optional(),
};

export const expenseInputSchema = z.object({ ...expenseFields, date: isoDate });
export type ExpenseInput = z.input<typeof expenseInputSchema>;
export const expenseUpdateSchema = z.object({ ...expenseFields, date: isoDate, revision: z.number().int().min(0), targetHouseholdId: id.optional() });
export type ExpenseUpdate = z.input<typeof expenseUpdateSchema>;
export const revisionSchema = z.object({ revision: z.number().int().min(0) });

export const expensePaymentSchema = z.object({
  fromUserId: id,
  amountCents: total,
  createdAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  createdBy: id,
});

/**
 * A shared expense as the server shows it to the caller. `accountId` is the payer's private
 * account: the server sends it only to the payer, and the web never shows it to anyone else.
 */
export const sharedExpenseSchema = z.object({
  ...expenseFields,
  date: isoDate,
  id,
  householdId: id,
  splits: z.array(amountAllocation),
  receipt: receiptSchema.optional(),
  revision: z.number().int().min(0),
  createdBy: id,
  createdAt: instant,
  updatedBy: id,
  updatedAt: instant,
  recurringId: id.optional(),
  payments: z.array(expensePaymentSchema),
  paymentsClosed: z.boolean(),
});
export type SharedExpense = z.infer<typeof sharedExpenseSchema>;

export const reimbursementInputSchema = z.object({ fromUserId: id, toUserId: id, amountCents: total });
export type Transfer = z.infer<typeof reimbursementInputSchema>;
export const reimbursementSchema = z.object({
  id,
  householdId: id,
  month: monthKey,
  fromUserId: id,
  toUserId: id,
  amountCents: total,
  createdBy: id,
  createdAt: instant,
  expenseId: id.optional(),
});
export type Reimbursement = z.infer<typeof reimbursementSchema>;
export const balanceSchema = z.object({ userId: id, balanceCents: z.number().int() });
export const suggestionSchema = z.object({ fromUserId: id, toUserId: id, amountCents: total });
export const monthRecapSchema = z.object({
  month: monthKey,
  expenses: z.array(sharedExpenseSchema),
  reimbursements: z.array(reimbursementSchema),
  balances: z.array(balanceSchema),
  suggestions: z.array(suggestionSchema),
  overdue: z.boolean(),
  overdueMonths: z.array(monthKey),
});
export type MonthRecap = z.infer<typeof monthRecapSchema>;

export const auditEventSchema = z.object({
  id,
  householdId: id,
  expenseId: id.optional(),
  actorId: id,
  action: z.string(),
  before: z.unknown(),
  after: z.unknown(),
  createdAt: instant,
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

const ruleFields = { ...expenseFields, nextDate: isoDate, frequency: frequencySchema };
export const sharedRecurringInputSchema = z.object(ruleFields);
export type SharedRecurringInput = z.input<typeof sharedRecurringInputSchema>;
export const sharedRecurringUpdateSchema = z.object({ ...ruleFields, active: z.boolean(), revision: z.number().int().min(0) });
export type SharedRecurringUpdate = z.input<typeof sharedRecurringUpdateSchema>;
export const sharedRecurringSchema = z.object({
  ...ruleFields,
  id,
  householdId: id,
  anchorDay: z.number().int().min(1).max(31).optional(),
  active: z.boolean(),
  revision: z.number().int().min(0),
});
export type SharedRecurring = z.infer<typeof sharedRecurringSchema>;

/* ---------- emailed receipts (server MAZ-184) ---------- */

/** A live private receipt address. Times are Unix milliseconds. */
export const receiptEmailAddressSchema = z.object({
  address: z.string().min(3).max(320),
  createdAt: instant,
  expiresAt: instant,
  lastReceivedAt: instant.nullable(),
  allowedSenders: z.array(z.string()).max(50),
});
export type ReceiptEmailAddress = z.infer<typeof receiptEmailAddressSchema>;

/** `GET`, `POST` and `PATCH /api/receipt-email`. `enabled: false`: the server has the feature off, so nothing is shown. */
export const receiptEmailSchema = z.object({
  enabled: z.boolean(),
  domain: z.string().nullable(),
  address: receiptEmailAddressSchema.nullable(),
});
export type ReceiptEmail = z.infer<typeof receiptEmailSchema>;

/** `PATCH /api/receipt-email` body: extend the lifetime, or replace the allowed senders. */
export const receiptEmailUpdateSchema = z.object({
  extend: z.boolean().optional(),
  allowedSenders: z.array(z.string().max(254)).max(50).optional(),
});
export type ReceiptEmailUpdate = z.infer<typeof receiptEmailUpdateSchema>;

/** One file of an inbox item: the rendered email or an attachment. `name` is display text only, never markup. */
export const receiptInboxFileSchema = z.object({
  receiptId: id,
  kind: z.enum(["email", "attachment"]),
  name: z.string().max(255),
  mime: z.string().max(100),
  sizeBytes: z.number().int().min(0),
  linked: z.boolean(),
  uri: z.string().max(500),
});
export type ReceiptInboxFile = z.infer<typeof receiptInboxFileSchema>;

/** One received email in the owner-only inbox. `from` and `subject` are plain text, never markup. */
export const receiptInboxItemSchema = z.object({
  id,
  from: z.string(),
  subject: z.string(),
  receivedAt: instant,
  status: z.enum(["to_attach", "partly_attached", "attached"]),
  senderVerified: z.boolean(),
  expiresAt: instant.nullable(),
  attachedAt: instant.nullable(),
  files: z.array(receiptInboxFileSchema),
});
export type ReceiptInboxItem = z.infer<typeof receiptInboxItemSchema>;

export const receiptInboxPageSchema = z.object({
  items: z.array(receiptInboxItemSchema),
  next: z.string().nullable(),
});
export type ReceiptInboxPage = z.infer<typeof receiptInboxPageSchema>;

/** Discard and Done: files deleted, and files kept because something links them. */
export const receiptInboxCleanupSchema = z.object({ deleted: z.number().int().min(0), kept: z.number().int().min(0) });
export type ReceiptInboxCleanup = z.infer<typeof receiptInboxCleanupSchema>;
