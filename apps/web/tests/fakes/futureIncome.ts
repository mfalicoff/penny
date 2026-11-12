import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dateKeyIn } from "@domain/calendar.ts";
import type { Ledger } from "@domain/ledger.ts";

/**
 * MAZ-136's shared fixtures, read by path: `redesign-states.json` `dana-2026-10` (the expected
 * totals) and dana's ledger from the `future-income` seed in `full-stack-seeds.json`. `today` is
 * the fixture clock's date in dana's time zone (2026-10-15 in Toronto).
 */
type Amounts = { expenseCents: number; incomeCents: number; investmentCents: number };
type Line = { title: string; date: string; shareCents: number };
export type DanaTotals = { clock: string; timeZone: string; recorded: Amounts; projected: Amounts; expected: Line[]; scheduled: Line[] };
type Seeds = { scenarios: { name: string; steps: { as?: string; ledger?: Ledger }[] }[] };

const fixture = (name: string): unknown => JSON.parse(readFileSync(resolve(process.cwd(), "../../contracts/fixtures", name), "utf8"));

export function danaOctober(): { expected: DanaTotals; seed: Ledger; today: string; month: string } {
  const expected = (fixture("redesign-states.json") as { totals: Record<string, DanaTotals> }).totals["dana-2026-10"];
  const scenario = (fixture("full-stack-seeds.json") as Seeds).scenarios.find((item) => item.name === "future-income");
  const seed = [...(scenario?.steps ?? [])].reverse().find((step) => step.ledger && step.as === "dana")?.ledger;
  if (!expected || !seed) throw new Error("dana-2026-10 or the future-income seed is missing");
  const today = dateKeyIn(new Date(expected.clock), expected.timeZone);
  return { expected, seed, today, month: today.slice(0, 7) };
}

export const totalsOf = (amounts: Amounts) => ({ income: amounts.incomeCents, expense: amounts.expenseCents, investment: amounts.investmentCents });
