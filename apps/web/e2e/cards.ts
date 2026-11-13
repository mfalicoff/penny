import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SeedContext } from "./stack";

// Shared pieces of the MAZ-122 card captures (cards.real.spec.ts): the redesign states and
// specimens from contracts/, the viewport per platform, and the report beside the captures in
// <repository>/test-results/cards/web/.

const repository = fileURLToPath(new URL("../../..", import.meta.url));
export const outputDirectory = `${repository}/test-results/cards/web`;

export type Appearance = "light" | "dark";
export type Status = "captured" | "not-built" | "blocked" | "not-applicable" | "failed";

export interface CardState {
  specimen: string;
  platform: string;
  appearances: Appearance[];
  scenario: string | null;
  as?: string;
  client?: "static" | "signed-out";
  view: string;
  month?: string;
  search?: { query: string };
  totals?: string;
  blockedBy?: string;
  fault?: { target?: string; method?: string; pathPrefix?: string; status?: number; abort?: boolean; times?: number };
  staleWrite?: {
    method: string;
    path: string;
    requests: { body: Record<string, unknown>; expectStatus: number; expectError?: string }[];
  };
}

interface RedesignStates {
  clock: string;
  states: CardState[];
}

interface DesignBaseline {
  specimens: { id: string; name: string; viewport: { w: number; h: number }; webIssue: string | null }[];
}

const read = (path: string): unknown => JSON.parse(readFileSync(`${repository}/${path}`, "utf8"));

export const redesign = read("contracts/fixtures/redesign-states.json") as RedesignStates;
export const specimens = (read("contracts/design-baseline.json") as DesignBaseline).specimens;

/** The browser viewport for a card: the web window, the iPad landscape window or the iPhone's points. */
export function viewportFor(id: string) {
  if (id.startsWith("web-")) return { width: 1440, height: 900 };
  if (id.startsWith("ipad-")) return { width: 1194, height: 834 };
  if (id.startsWith("iphone-")) return { width: 402, height: 874 };
  return null;
}

/** The seeder's context, with the user ids it learns from member lists. */
export type Seed = SeedContext & { userIds: Record<string, string> };

/** Replaces `$user:alias`, `$household:ref` and `$expense:ref` with the seeded ids. */
export function resolveRefs<T>(value: T, seed: Seed): T {
  const text = JSON.stringify(value).replace(/\$(user|household|expense):([\w-]+)/g, (whole, kind: string, ref: string) => {
    const table = kind === "user" ? seed.userIds : kind === "household" ? seed.households : seed.expenseIds;
    const id = table[ref];
    if (!id) throw new Error(`No seeded ${kind} ${ref} for ${whole}`);
    return id;
  });
  return JSON.parse(text) as T;
}

export interface ReportEntry {
  id: string;
  appearance: Appearance;
  status: Status;
  file: string | null;
  viewport: { width: number; height: number } | null;
  view: string;
  note: string;
}

/**
 * Merges `entries` into report.json, replacing earlier entries for the same cards, so a run with
 * --grep updates only the cards it ran. Ordered as contracts/design-baseline.json lists them.
 */
export function writeReport(entries: ReportEntry[]) {
  if (entries.length === 0) return;
  mkdirSync(outputDirectory, { recursive: true });
  const file = `${outputDirectory}/report.json`;
  const ran = new Set(entries.map((entry) => entry.id));
  const kept = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as ReportEntry[]).filter((entry) => !ran.has(entry.id)) : [];
  const order = new Map(specimens.map((specimen, index) => [specimen.id, index]));
  const all = [...kept, ...entries].sort(
    (a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999) || a.appearance.localeCompare(b.appearance) * -1,
  );
  writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`);
}
