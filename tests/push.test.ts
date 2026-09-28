import { test } from "node:test";
import assert from "node:assert/strict";
import { householdPushPath } from "../src/data/push.ts";

test("expense and reimbursement pushes route to their household month", () => {
  assert.equal(householdPushPath({ householdId: "home-1", expenseId: "rent_1", month: "2026-09" }),
    "/households/home-1?month=2026-09&expenseId=rent_1");
  assert.equal(householdPushPath({ householdId: "home-1", month: "2026-09" }),
    "/households/home-1?month=2026-09");
});

test("untrusted notification payloads cannot navigate to another route", () => {
  for (const value of [null, "oops", {}, { householdId: "../auth", month: "2026-09" },
    { householdId: "home", month: "2026-13" },
    { householdId: "home", month: "2026-09", expenseId: "/../../auth" }]) {
    assert.equal(householdPushPath(value), null);
  }
});
