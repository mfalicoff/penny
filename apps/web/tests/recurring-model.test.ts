// @vitest-environment node
import { describe, expect, it } from "vitest";
import { removeSchedule, saveSchedule, setScheduleActive } from "@domain/commands.ts";
import { materialize, type Ledger, type Recurring } from "@domain/ledger.ts";
import {
  addSchedule,
  cadenceLabel,
  checkDraft,
  datesDueBy,
  draftFromRule,
  editedRule,
  emptyDraft,
  newRule,
  relativeDay,
  resumeDate,
  sortSchedules,
  upcomingDates,
  type ScheduleDraft,
} from "../src/features/recurring/model";

/** Synthetic data only. */
const TODAY = "2026-11-10";
const ledger = (extra: Partial<Ledger> = {}): Ledger => ({
  version: 4,
  currency: "CAD",
  accounts: [{ id: "visa", name: "Visa", type: "credit" }],
  trips: [],
  categories: [
    { id: "home", name: "Home", icon: "home-outline", color: "#C6953A", kind: "expense" },
    { id: "salary", name: "Salary", icon: "briefcase-outline", color: "#6C9C79", kind: "income" },
    { id: "investments", name: "Investments", icon: "trending-up-outline", color: "#678DB1", kind: "investment" },
  ],
  transactions: [],
  recurring: [],
  ...extra,
});
const rule = (extra: Partial<Recurring> = {}): Recurring => ({
  id: "net",
  title: "Internet",
  kind: "expense",
  total: 6500,
  share: 6500,
  categoryId: "home",
  accountId: "visa",
  date: "2026-03-18",
  note: "",
  frequency: "monthly",
  nextDate: "2026-11-18",
  anchorDay: 18,
  active: true,
  ...extra,
});
const draft = (extra: Partial<ScheduleDraft> = {}): ScheduleDraft => ({ ...emptyDraft(ledger(), TODAY), title: "Internet", amount: "65", categoryId: "home", ...extra });
const build = (value: ScheduleDraft, on = ledger(), editing?: Recurring) => {
  const result = checkDraft(value, on, TODAY, editing);
  if (!result.built) throw new Error(JSON.stringify(result.errors));
  return result.built;
};

describe("dates and labels", () => {
  it("describes each cadence with its anchor", () => {
    expect(cadenceLabel(rule())).toBe("Every month on the 18th");
    expect(cadenceLabel(rule({ frequency: "weekly", nextDate: "2026-11-17" }))).toBe("Every week on Tuesday");
    expect(cadenceLabel(rule({ frequency: "yearly", nextDate: "2027-03-18" }))).toBe("Every year on Mar 18");
    expect(cadenceLabel(rule({ anchorDay: 31, nextDate: "2026-11-30" }))).toBe("Every month on the 31st (the last day in shorter months)");
    expect(cadenceLabel(rule({ anchorDay: 22 }))).toContain("22nd");
    expect(cadenceLabel(rule({ anchorDay: 11 }))).toContain("11th");
  });

  it("keeps the anchor day through short months and leap years", () => {
    expect(upcomingDates(rule({ nextDate: "2027-01-31", anchorDay: 31 }), 4)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
    expect(upcomingDates(rule({ nextDate: "2028-01-30", anchorDay: 30 }), 3)).toEqual(["2028-01-30", "2028-02-29", "2028-03-30"]);
    expect(upcomingDates(rule({ frequency: "yearly", nextDate: "2028-02-29", anchorDay: 29 }), 3)).toEqual(["2028-02-29", "2029-02-28", "2030-02-28"]);
    expect(upcomingDates(rule({ frequency: "weekly", nextDate: "2026-12-29", anchorDay: 29 }), 3)).toEqual(["2026-12-29", "2027-01-05", "2027-01-12"]);
    // Nothing past the ledger's last day.
    expect(upcomingDates(rule({ frequency: "yearly", nextDate: "2100-06-01", anchorDay: 1 }), 3)).toEqual(["2100-06-01"]);
  });

  it("skips paused dates when resuming, as the shared setScheduleActive does", () => {
    const paused = rule({ active: false, nextDate: "2026-09-18" });
    expect(resumeDate(paused, TODAY)).toBe("2026-11-18");
    const resumed = setScheduleActive("net", true, TODAY)(ledger({ recurring: [paused] }));
    expect(resumed.recurring[0]?.nextDate).toBe(resumeDate(paused, TODAY));
    expect(materialize(resumed, TODAY).transactions).toEqual([]);
  });

  it("lists the dates a backdated schedule records at once, as materialize does", () => {
    expect(datesDueBy("2026-09-30", "monthly", 30, TODAY)).toEqual(["2026-09-30", "2026-10-30"]);
    expect(datesDueBy("2026-11-11", "monthly", 11, TODAY)).toEqual([]);
    const created = materialize(addSchedule(newRule(draft({ date: "2026-09-30" }), build(draft({ date: "2026-09-30" })), "r"))(ledger()), TODAY);
    expect(created.transactions.map((entry) => entry.id)).toEqual(["r:2026-09-30", "r:2026-10-30"]);
    expect(created.recurring[0]?.nextDate).toBe("2026-11-30");
  });

  it("says how far away a date is", () => {
    expect(relativeDay("2026-11-10", TODAY)).toBe("today");
    expect(relativeDay("2026-11-11", TODAY)).toBe("tomorrow");
    expect(relativeDay("2026-11-19", TODAY)).toBe("in 9 days");
    // Across a daylight-saving change.
    expect(relativeDay("2027-03-20", "2027-03-10")).toBe("in 10 days");
  });

  it("orders active schedules by next date, then paused ones by name", () => {
    const list = sortSchedules([rule({ id: "b", title: "Gym", active: false }), rule({ id: "c", nextDate: "2026-12-06" }), rule({ id: "a", nextDate: "2026-11-15" }), rule({ id: "d", title: "Art", active: false })]);
    expect(list.map((item) => item.id)).toEqual(["a", "c", "d", "b"]);
  });
});

describe("the schedule draft", () => {
  it("checks every field and names what to fix", () => {
    const { errors } = checkDraft(draft({ title: " ", amount: "0", date: "2026-02-30", categoryId: "salary", accountId: "gone", note: "x".repeat(1001) }), ledger(), TODAY);
    expect(errors).toEqual({
      title: "Add a name for this schedule.",
      amount: "Enter an amount greater than zero.",
      date: "Choose a valid date between 2000 and 2100.",
      categoryId: "Choose a category.",
      accountId: "This account was removed on another device. Choose another account.",
      note: "Use up to 1000 characters for the note.",
    });
    expect(checkDraft(draft({ amount: "12.345" }), ledger(), TODAY).errors.amount).toBe("Enter an amount with up to two decimal places.");
    expect(checkDraft(draft({ split: "amount", shareInput: "70" }), ledger(), TODAY).errors.share).toBe("Your share cannot exceed the receipt total.");
    expect(checkDraft(draft({ split: "equal", shareInput: "1" }), ledger(), TODAY).errors.share).toBe("Split between 2 and 100 people.");
  });

  it("builds income, expense and investment rules anchored on the first date", () => {
    expect(newRule(draft({ split: "percent", shareInput: "50" }), build(draft({ split: "percent", shareInput: "50" })), "r")).toMatchObject({ total: 6500, share: 3250, nextDate: TODAY, anchorDay: 10, active: true, date: TODAY });
    const income = draft({ kind: "income", categoryId: "salary", title: "Payday", amount: "2250", date: "2026-11-15" });
    expect(newRule(income, build(income), "p")).toMatchObject({ kind: "income", share: 225000, anchorDay: 15 });
    const invest = draft({ kind: "investment", categoryId: "investments", frequency: "weekly", accountId: "visa" });
    expect(newRule(invest, build(invest), "i")).toMatchObject({ kind: "investment", frequency: "weekly", accountId: "visa" });
    expect(newRule(draft(), build(draft()), "n")).not.toHaveProperty("accountId");
  });

  it("edits keep the first date and the anchor unless the next date moves, and only touch future dates", () => {
    const original = rule({ anchorDay: 31, nextDate: "2026-11-30" });
    const recorded = { id: "net:2026-10-31", title: "Internet", kind: "expense" as const, total: 6500, share: 6500, categoryId: "home", accountId: "visa", date: "2026-10-31", note: "", recurringId: "net" };
    const start = ledger({ recurring: [original], transactions: [recorded] });
    const same = draftFromRule(original);
    const priced = { ...same, amount: "70", accountId: "" };
    const edited = editedRule(original, priced, build(priced, start, original));
    expect(edited).toMatchObject({ total: 7000, anchorDay: 31, nextDate: "2026-11-30", date: "2026-03-18" });
    expect(edited).not.toHaveProperty("accountId");
    const after = materialize(saveSchedule(edited, original)(start), TODAY);
    expect(after.transactions).toEqual([recorded]);

    const moved = { ...same, date: "2026-11-20" };
    expect(editedRule(original, moved, build(moved, start, original)).anchorDay).toBe(20);
    // Changing the cadence re-anchors on the next date too, even when the date stays.
    const recadenced = { ...same, frequency: "weekly" as const };
    expect(editedRule(original, recadenced, build(recadenced, start, original)).anchorDay).toBe(30);
    expect(checkDraft({ ...same, date: "2026-11-01" }, start, TODAY, original).errors.date).toBe("Choose today or a later date. Past entries aren't recorded again.");
    // Saving over a version changed elsewhere is refused by the shared command.
    expect(() => saveSchedule(edited, original)(ledger({ recurring: [{ ...original, title: "Fibre" }] }))).toThrow("changed on another device");
  });

  it("reads a rule back into the draft, with a split share as an amount", () => {
    expect(draftFromRule(rule({ total: 6500, share: 3250 }))).toMatchObject({ amount: "65.00", split: "amount", shareInput: "32.50", accountId: "visa", date: "2026-11-18" });
    expect(draftFromRule(rule({ kind: "income", categoryId: "salary", accountId: undefined }))).toMatchObject({ split: "full", accountId: "" });
  });

  it("adds a schedule only if its category and account still exist, and removing keeps recorded entries", () => {
    const item = rule({ id: "new" });
    expect(() => addSchedule(item)(ledger({ accounts: [] }))).toThrow("payment account was removed");
    expect(() => addSchedule({ ...item, categoryId: "gone" })(ledger())).toThrow("category was removed");
    const once = addSchedule(item)(ledger());
    expect(addSchedule(item)(once).recurring).toHaveLength(1);
    const recorded = materialize({ ...once, recurring: [{ ...item, nextDate: "2026-11-01", anchorDay: 1 }] }, TODAY);
    const removed = removeSchedule("new")(recorded);
    expect(removed.recurring).toEqual([]);
    expect(removed.transactions.map((entry) => entry.id)).toEqual(["new:2026-11-01"]);
  });
});
