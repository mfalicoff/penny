import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

// Shared helpers for the real-stack acceptance journeys (MAZ-96). They talk to the full-stack
// test environment (docs/reference/test-environment.md) only through what `test-env run`
// exports: PENNY_API_URL, PENNY_TEST_TOKEN and PENNY_TEST_RUN. Test controls (`/api/test/*`)
// arrange the clock, faults and accounts; every business call goes through the same API the
// browser and the iOS app use. Accounts are synthetic `.test` addresses.

const repository = fileURLToPath(new URL("../../..", import.meta.url));

export const realStack = process.env.PENNY_REAL_STACK === "1";
export const skipReason = "needs the full-stack test environment (PENNY_REAL_STACK=1)";

function environment() {
  const api = process.env.PENNY_API_URL;
  const token = process.env.PENNY_TEST_TOKEN;
  if (!api || !token) throw new Error("PENNY_API_URL and PENNY_TEST_TOKEN come from `npm run test-env -- run` or `env`.");
  return { api, token, run: process.env.PENNY_TEST_RUN };
}

/** Calls a test control (`/api/test/<path>`) with the run's token. */
export async function control(method: string, path: string, body?: unknown): Promise<unknown> {
  const { api, token } = environment();
  const response = await fetch(`${api}/api/test/${path}`, {
    method,
    headers: { "X-Penny-Test-Token": token, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`test control ${method} ${path}: ${String(response.status)}`);
  const text = await response.text();
  return text ? (JSON.parse(text) as unknown) : null;
}

/** Pins the server clock, or returns it to real time with `null`. */
export async function pinClock(iso: string | null) {
  await control(iso ? "PUT" : "DELETE", "clock", iso ? { now: iso } : undefined);
}

export interface FaultRule {
  method?: string;
  pathPrefix: string;
  status?: number;
  abort?: boolean;
  delayMs?: number;
  times?: number;
}

export async function setFaults(rules: FaultRule[]) {
  await control("PUT", "faults", { rules });
}

export async function clearFaults() {
  await control("DELETE", "faults");
}

export interface TestUser {
  email: string;
  password: string;
}

/** A new ready account from `POST /api/test/users`. */
export async function testUser(label: string): Promise<TestUser> {
  const user = (await control("POST", "users", { label })) as TestUser;
  return { email: user.email, password: user.password };
}

export interface SeedContext {
  scenario: string;
  today: string;
  users: Record<string, { email: string; password: string; token: string }>;
  households: Record<string, string>;
  expenseIds: Record<string, string>;
}

// Runs scripts/test-env/seed.mjs (the runner's own seeder) in a child process, with a fresh run
// tag so every call gets its own users (`<alias>.<tag>@penny.test`) and data, even when several
// Playwright projects seed the same scenario into one environment.
const SEED_PROGRAM = `
import { scenario, seed } from ${JSON.stringify(`${repository}/scripts/test-env/seed.mjs`)};
const api = process.env.PENNY_API_URL;
const setClock = async (now) => {
  const response = await fetch(api + "/api/test/clock", { method: "PUT", headers: { "X-Penny-Test-Token": process.env.PENNY_TEST_TOKEN, "Content-Type": "application/json" }, body: JSON.stringify({ now }) });
  if (!response.ok) throw new Error("clock " + response.status);
};
const context = await seed(scenario(process.argv[1]), { apiUrl: api, runTag: process.argv[2], setClock });
process.stdout.write(JSON.stringify(context));
`;

/**
 * Seeds a scenario from contracts/fixtures/full-stack-seeds.json into this environment with new
 * users and returns the seeder's context: aliases, passwords, sessions, household and expense ids.
 * Seeding pins the server clock to the scenario's clock.
 */
export function seedScenario(name: string): SeedContext {
  environment();
  const tag = randomBytes(4).toString("hex");
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", SEED_PROGRAM, name, tag], { cwd: repository, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`seed ${name} failed: ${result.stderr}`);
  return JSON.parse(result.stdout) as SeedContext;
}

/** The scenario definition itself (steps, search expectations, pending edits). */
export function scenarioDefinition(name: string): unknown {
  const file = JSON.parse(readFileSync(`${repository}/contracts/fixtures/full-stack-seeds.json`, "utf8")) as { scenarios: { name: string }[] };
  const found = file.scenarios.find((item) => item.name === name);
  if (!found) throw new Error(`Unknown scenario ${name}`);
  return found;
}

export interface Session {
  context: BrowserContext;
  page: Page;
}

/** A browser context signed in as `user` through the real login endpoint (an httpOnly cookie). */
export async function signIn(browser: Browser, baseURL: string | undefined, user: TestUser, at?: string): Promise<Session> {
  const context = await browser.newContext(baseURL ? { baseURL } : {});
  const page = await context.newPage();
  if (at) await page.clock.setFixedTime(at);
  const response = await page.request.post("/api/auth/login", { data: { email: user.email, password: user.password } });
  expect(response.status(), `sign in ${user.email}`).toBe(200);
  return { context, page };
}

export interface LedgerSnapshot {
  revision: number;
  ledger: {
    currency: string;
    categories: { id: string; name: string; kind: string }[];
    accounts: { id: string; name: string }[];
    transactions: { id: string; title: string; kind: string; total: number; share: number; categoryId: string; date: string; note?: string; accountId?: string }[];
    [key: string]: unknown;
  };
}

/**
 * A second client that speaks the ledger protocol the iOS app uses (docs/ios-offline-sync.md):
 * bearer-token `GET /api/ledger` and revision-checked `PUT /api/ledger`, answered by 409 when the
 * revision is stale. It stands in for the simulator where no Xcode is available; the protocol, the
 * server and the database are real.
 */
export class LedgerClient {
  private readonly token: string;
  private readonly api: string;

  constructor(token: string, api = environment().api) {
    this.token = token;
    this.api = api;
  }

  static async signIn(user: TestUser) {
    const { api } = environment();
    const response = await fetch(`${api}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email, password: user.password }),
    });
    if (!response.ok) throw new Error(`login: ${String(response.status)}`);
    const body = (await response.json()) as { token: string };
    return new LedgerClient(body.token, api);
  }

  async request(method: string, path: string, body?: unknown) {
    const response = await fetch(`${this.api}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as unknown) : null };
  }

  async read(): Promise<LedgerSnapshot> {
    const { status, body } = await this.request("GET", "/api/ledger");
    if (status !== 200) throw new Error(`GET /api/ledger: ${String(status)}`);
    return body as LedgerSnapshot;
  }

  /** Writes `ledger` against `revision`; returns the status (200, or 409 when stale). */
  async write(revision: number, ledger: LedgerSnapshot["ledger"]) {
    const { status, body } = await this.request("PUT", "/api/ledger", { revision, ledger });
    return { status, body: body as LedgerSnapshot | { error: string } };
  }

  async search(request: Record<string, unknown>) {
    const { status, body } = await this.request("POST", "/api/v1/search/transactions", request);
    if (status !== 200) throw new Error(`search: ${String(status)}`);
    return body as SearchPage;
  }
}

export interface SearchPage {
  items: { key: string; source: "personal" | "shared"; match: string | null; entry: { id: string; title: string; date: string } }[];
  totalCount: number;
  nextCursor: string | null;
}

/** Fails the test on console errors and uncaught page errors (failed requests are expected in fault journeys). */
export function watchConsole(page: Page, allow: RegExp[] = []) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (allow.some((pattern) => pattern.test(text))) return;
    errors.push(`console.error: ${text}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}
