// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Household, HouseholdDetail, SharedRecurring } from "../src/api/schemas";
import { shareOfRule, sharedSchedules } from "../src/features/recurring/shared";

/** Shared schedules on Recurring (MAZ-177). Synthetic data only. */
const JOINED = Date.UTC(2026, 0, 5, 12);
const household: Household = { id: "h1", name: "Maison", currency: "CAD", creatorId: "u-alex", createdAt: JOINED, memberCount: 2 };
const member = (userId: string, email: string, extra: Partial<HouseholdDetail["members"][number]> = {}) => ({ userId, email, joinedAt: JOINED, joinedOn: "2026-01-05", ...extra });
const detail = (members = [member("u-alex", "alex@example.test"), member("u-bea", "bea@example.test")]): HouseholdDetail => ({ household, members });
const rule = (extra: Partial<SharedRecurring> = {}): SharedRecurring => ({
  id: "r1",
  householdId: "h1",
  title: "Streaming",
  totalCents: 1601,
  payerUserId: "u-bea",
  splitMode: "equal",
  category: { name: "Fun", icon: "film-outline", color: "#5E5CE6" },
  note: "",
  nextDate: "2026-10-20",
  frequency: "monthly",
  anchorDay: 20,
  active: true,
  revision: 1,
  ...extra,
});

describe("shareOfRule", () => {
  it("splits equally among the members active on the next date, the odd cent to the first id", () => {
    expect(shareOfRule(rule(), detail(), "u-alex")).toBe(801);
    expect(shareOfRule(rule(), detail(), "u-bea")).toBe(800);
  });

  it("keeps an exact or percentage split while the same members are active", () => {
    const exact = rule({ splitMode: "exact", allocations: [{ userId: "u-alex", amountCents: 401 }, { userId: "u-bea", amountCents: 1200 }] });
    expect(shareOfRule(exact, detail(), "u-alex")).toBe(401);
    const percent = rule({ splitMode: "percent", totalCents: 10_000, allocations: [{ userId: "u-alex", percentBasisPoints: 2500 }, { userId: "u-bea", percentBasisPoints: 7500 }] });
    expect(shareOfRule(percent, detail(), "u-alex")).toBe(2500);
  });

  it("splits equally when the members changed, or the stored split no longer adds up", () => {
    const three = detail([member("u-alex", "alex@example.test"), member("u-bea", "bea@example.test"), member("u-cy", "cy@example.test")]);
    const exact = rule({ splitMode: "exact", totalCents: 900, allocations: [{ userId: "u-alex", amountCents: 100 }, { userId: "u-bea", amountCents: 800 }] });
    expect(shareOfRule(exact, three, "u-alex")).toBe(300);
    const broken = rule({ splitMode: "exact", totalCents: 900, allocations: [{ userId: "u-alex", amountCents: 100 }, { userId: "u-bea", amountCents: 100 }] });
    expect(shareOfRule(broken, detail(), "u-alex")).toBe(450);
  });

  it("leaves out someone who isn't a member on the next date", () => {
    const later = detail([member("u-alex", "alex@example.test", { joinedOn: "2026-11-01" }), member("u-bea", "bea@example.test")]);
    expect(shareOfRule(rule(), later, "u-alex")).toBeUndefined();
  });
});

describe("sharedSchedules", () => {
  it("lists the rules of loaded households the account belongs to and skips the rest", () => {
    const other: Household = { ...household, id: "h2", name: "Elsewhere" };
    const list = sharedSchedules([household, other], [detail(), undefined], [[rule(), rule({ id: "r2", title: "Paused gym", active: false })], [rule({ id: "r3", householdId: "h2" })]], "Alex@Example.test");
    expect(list.map((item) => [item.rule.title, item.household.name, item.shareCents])).toEqual([
      ["Streaming", "Maison", 801],
      ["Paused gym", "Maison", 801],
    ]);
    expect(sharedSchedules([household], [detail()], [[rule()]], "dee@example.test")).toEqual([]);
  });
});
