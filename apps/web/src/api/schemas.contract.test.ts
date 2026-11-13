// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  auditEventSchema,
  balanceSchema,
  credentialsSchema,
  expenseInputSchema,
  expensePaymentSchema,
  expenseUpdateSchema,
  householdDetailSchema,
  householdInputSchema,
  householdMemberSchema,
  householdSchema,
  inviteSchema,
  joinSchema,
  monthRecapSchema,
  reimbursementInputSchema,
  reimbursementSchema,
  revisionSchema,
  sharedExpenseSchema,
  sharedRecurringInputSchema,
  sharedRecurringSchema,
  sharedRecurringUpdateSchema,
  suggestionSchema,
  entrySchema,
  errorSchema,
  meSchema,
  oidcChallengeSchema,
  oidcCompleteSchema,
  oidcConfigSchema,
  okSchema,
  projectedExpenseSchema,
  receiptSchema,
  searchRequestSchema,
  searchResponseSchema,
  sessionSchema,
} from "./schemas";

interface OpenApiSchema {
  properties?: Record<string, { enum?: string[]; anyOf?: unknown[]; minimum?: number; maximum?: number; minLength?: number; maxLength?: number }>;
  required?: string[];
}

const root = new URL("../../../../contracts/", import.meta.url);
const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const openapi = read("openapi.json") as { components: { schemas: Record<string, OpenApiSchema> } };
const fixtures = read("fixtures/search-cases.json") as {
  requests: unknown[];
  response: unknown;
};

const models: [string, z.ZodType][] = [
  ["Credentials", credentialsSchema],
  ["Session", sessionSchema],
  ["Me", meSchema],
  ["Ok", okSchema],
  ["Error", errorSchema],
  ["OidcConfig", oidcConfigSchema],
  ["OidcChallenge", oidcChallengeSchema],
  ["OidcComplete", oidcCompleteSchema],
  ["Receipt", receiptSchema],
  ["Entry", entrySchema],
  ["ProjectedExpense", projectedExpenseSchema],
  ["SearchRequest", searchRequestSchema],
  ["SearchResponse", searchResponseSchema],
  ["Household", householdSchema],
  ["HouseholdMember", householdMemberSchema],
  ["HouseholdDetail", householdDetailSchema],
  ["HouseholdInput", householdInputSchema],
  ["Join", joinSchema],
  ["Invite", inviteSchema],
  ["ExpenseInput", expenseInputSchema],
  ["ExpenseUpdate", expenseUpdateSchema],
  ["Expense", sharedExpenseSchema],
  ["ExpensePayment", expensePaymentSchema],
  ["Revision", revisionSchema],
  ["ReimbursementInput", reimbursementInputSchema],
  ["Reimbursement", reimbursementSchema],
  ["Balance", balanceSchema],
  ["Suggestion", suggestionSchema],
  ["MonthRecap", monthRecapSchema],
  ["AuditEvent", auditEventSchema],
  ["SharedRecurringInput", sharedRecurringInputSchema],
  ["SharedRecurringUpdate", sharedRecurringUpdateSchema],
  ["SharedRecurring", sharedRecurringSchema],
];

describe("DTO models match contracts/openapi.json", () => {
  it.each(models)("%s has the same fields, required set and enums", (name, model) => {
    const contract = openapi.components.schemas[name];
    expect(contract, `${name} must exist in the OpenAPI document`).toBeDefined();
    const generated = z.toJSONSchema(model, { io: "input" }) as OpenApiSchema;
    expect(Object.keys(generated.properties ?? {}).sort()).toEqual(Object.keys(contract?.properties ?? {}).sort());
    expect([...(generated.required ?? [])].sort()).toEqual([...(contract?.required ?? [])].sort());
    for (const [field, spec] of Object.entries(contract?.properties ?? {})) {
      const mine = generated.properties?.[field];
      if (spec.enum) expect([...(mine?.enum ?? [])].sort(), `${name}.${field} enum`).toEqual([...spec.enum].sort());
      for (const bound of ["minimum", "maximum", "minLength", "maxLength"] as const) {
        // Nullable fields are an anyOf in generated JSON Schema; their bounds are covered by the fixtures.
        if (spec[bound] !== undefined && mine?.anyOf === undefined) expect(mine?.[bound], `${name}.${field} ${bound}`).toBe(spec[bound]);
      }
    }
  });

  it("covers every search item variant", () => {
    const item = openapi.components.schemas["SearchItem"] as { oneOf?: unknown[] } | undefined;
    expect(item?.oneOf).toHaveLength(2);
  });
});

describe("search contract fixtures", () => {
  it("accepts every valid request example", () => {
    for (const request of fixtures.requests) expect(searchRequestSchema.safeParse(request).success).toBe(true);
  });

  it("accepts the response example", () => {
    expect(searchResponseSchema.parse(fixtures.response).items).toHaveLength(1);
  });

  it("rejects a shared item whose entry is a personal entry, and a bad version", () => {
    const personal = (fixtures.response as { items: { entry: unknown }[] }).items[0];
    expect(
      searchResponseSchema.safeParse({ version: 1, items: [{ key: "shared:x", source: "shared", match: null, entry: personal?.entry }], totalCount: 1, nextCursor: null }).success,
    ).toBe(false);
    expect(searchResponseSchema.safeParse({ ...(fixtures.response as object), version: 2 }).success).toBe(false);
  });
});
