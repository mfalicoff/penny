// Runs a declarative scenario from contracts/fixtures/full-stack-seeds.json against a
// server over its public HTTP API (MAZ-62). The same steps run on the legacy
// Node/SQLite server and the .NET/PostgreSQL API, so seeds double as differential
// journeys. Users get unique `.test` emails and random passwords per run.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

export const seedFile = new URL("../../contracts/fixtures/full-stack-seeds.json", import.meta.url);

export function scenarios() {
  return JSON.parse(readFileSync(seedFile, "utf8")).scenarios;
}

export function scenario(name) {
  const found = scenarios().find((item) => item.name === name);
  if (!found) throw new Error(`Unknown seed scenario: ${name}`);
  return found;
}

export class HttpError extends Error {
  constructor(method, path, status, body) {
    super(`${method} ${path} returned ${status}: ${body?.error ?? JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

/** Minimal JSON client with bearer sessions; records every exchange for comparison. */
export function client(apiUrl, { record } = {}) {
  return async function request(method, path, { token, body, expect } = {}) {
    const response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let value;
    try {
      value = text ? JSON.parse(text) : undefined;
    } catch {
      value = text;
    }
    record?.push({ method, path, status: response.status, body: value });
    const allowed = expect ?? [200, 201];
    if (!allowed.includes(response.status)) throw new HttpError(method, path, response.status, value);
    return { status: response.status, body: value };
  };
}

const reference = /\$(user|household|expense):([a-z0-9-]+)|\$(today|month)\b/g;

// Replaces "$user:alex", "$household:x", "$expense:x", "$today" and "$month" in
// strings (whole values or inside paths) anywhere in a JSON value.
export function resolve(value, context) {
  if (typeof value === "string") {
    return value.replace(reference, (token, kind, ref, day) => {
      if (day) return day === "today" ? context.today : context.today.slice(0, 7);
      const table = { user: context.userIds, household: context.households, expense: context.expenseIds }[kind];
      if (!(ref in table)) throw new Error(`Seed reference ${token} is not defined yet.`);
      return table[ref];
    });
  }
  if (Array.isArray(value)) return value.map((item) => resolve(item, context));
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item, context)]));
  return value;
}

/**
 * Seeds a scenario. `setClock` pins server time (the .NET test control); servers
 * without one (legacy) run at real time, so clock-dependent fields differ there.
 * @param {object} definition one entry of full-stack-seeds.json `scenarios`
 * @param {{ apiUrl: string, runTag?: string, setClock?: (iso: string) => Promise<void>,
 *   record?: object[] }} options
 */
export async function seed(definition, options) {
  const request = client(options.apiUrl, { record: options.record });
  const runTag = options.runTag ?? randomBytes(4).toString("hex");
  // "$now" scenarios follow the server's real day (legacy servers have no clock).
  const realTime = definition.clock === "$now";
  const finalClock = realTime ? options.now ?? new Date().toISOString() : definition.clock;
  const context = {
    scenario: definition.name, runTag, today: finalClock.slice(0, 10),
    users: {}, userIds: {}, households: {}, invites: {}, expenseIds: {}, expenses: {}, rules: {},
  };
  const clock = async (iso) => options.setClock && await options.setClock(iso);
  await clock(definition.steps.find((step) => step.clock)?.clock ?? finalClock);
  for (const alias of definition.users) {
    const email = `${alias}.${runTag}@penny.test`;
    const password = randomBytes(12).toString("hex");
    const { body } = await request("POST", "/api/auth/register", { body: { email, password }, expect: [201] });
    context.users[alias] = { email: body.email, password, token: body.token };
  }
  // User ids are learned from household member lists (the API exposes no id for self).
  const learnMembers = (members) => {
    for (const [alias, user] of Object.entries(context.users)) {
      const member = members.find((item) => item.email === user.email);
      if (member) context.userIds[alias] = member.userId;
    }
  };
  // Sessions last 30 days of server time, so moving a pinned clock forward can expire
  // them; signing in again keeps every alias usable at the new time.
  const refreshSessions = async () => {
    for (const user of Object.values(context.users)) {
      const { body } = await request("POST", "/api/auth/login", { body: { email: user.email, password: user.password } });
      user.token = body.token;
    }
  };
  for (const step of definition.steps) {
    const token = step.as ? context.users[step.as].token : undefined;
    if (step.clock) {
      await clock(step.clock);
      if (options.setClock) await refreshSessions();
    }
    else if (step.ledger) {
      const current = await request("GET", "/api/ledger", { token });
      await request("PUT", "/api/ledger", { token, body: { revision: current.body.revision, ledger: resolve(step.ledger, context) } });
    } else if (step.rename) {
      const current = await request("GET", "/api/ledger", { token });
      const ledger = structuredClone(current.body.ledger);
      for (const [kind, names] of Object.entries(step.rename))
        for (const item of ledger[kind]) if (item.id in names) item.name = names[item.id];
      await request("PUT", "/api/ledger", { token, body: { revision: current.body.revision, ledger } });
    } else if (step.createHousehold) {
      const { ref, ...body } = step.createHousehold;
      const created = await request("POST", "/api/households", { token, body, expect: [201] });
      context.households[ref] = created.body.household.id;
      learnMembers((await request("GET", `/api/households/${context.households[ref]}`, { token })).body.members);
    } else if (step.createTrip) {
      const { ref, ...body } = step.createTrip;
      const created = await request("POST", "/api/households/trips", { token, body, expect: [201] });
      context.households[ref] = created.body.household.id;
    } else if (step.invite) {
      const id = context.households[step.invite.household];
      const invite = await request("POST", `/api/households/${id}/invites`, { token, expect: [200, 201] });
      context.invites[step.invite.ref] = { code: invite.body.code, household: id };
    } else if (step.join) {
      const invite = context.invites[step.join.invite];
      const { invite: _ref, ...rest } = step.join;
      await request("POST", "/api/households/join", { token, body: { code: invite.code, ...rest }, expect: [200, 201] });
      learnMembers((await request("GET", `/api/households/${invite.household}`, { token })).body.members);
    } else if (step.expense) {
      const id = context.households[step.expense.household];
      const created = await request("POST", `/api/households/${id}/expenses`, {
        token, body: resolve(step.expense.body, context), expect: [201],
      });
      context.expenseIds[step.expense.ref] = created.body.expense.id;
      context.expenses[step.expense.ref] = { id: created.body.expense.id, household: id, revision: created.body.expense.revision };
    } else if (step.reimburse) {
      const { household, month, ...body } = step.reimburse;
      await request("POST", `/api/households/${context.households[household]}/months/${month}/reimbursements`, {
        token, body: resolve(body, context), expect: [201],
      });
    } else if (step.leave) {
      await request("POST", `/api/households/${context.households[step.leave.household]}/leave`, { token });
    } else if (step.sharedRecurring) {
      const id = context.households[step.sharedRecurring.household];
      const created = await request("POST", `/api/households/${id}/recurring`, {
        token, body: resolve(step.sharedRecurring.body, context), expect: [201],
      });
      context.rules[step.sharedRecurring.ref] = created.body.rule?.id ?? created.body.id;
    } else throw new Error(`Unknown seed step: ${JSON.stringify(step)}`);
  }
  await clock(finalClock);
  if (options.setClock) await refreshSessions();
  return context;
}

/** Applies a scenario's pendingEdits to a ledger (the unsynced local snapshot). */
export function applyPendingEdits(ledger, pending) {
  const local = structuredClone(ledger);
  const removed = new Set(pending.delete ?? []);
  local.transactions = local.transactions
    .filter((entry) => !removed.has(entry.id))
    .map((entry) => {
      const edit = (pending.edit ?? []).find((item) => item.id === entry.id);
      return edit ? { ...entry, ...edit.patch } : entry;
    });
  local.transactions.push(...(pending.create ?? []));
  return local;
}
