/**
 * An in-memory stand-in for the shared-household API (MAZ-56–59), for component tests and the
 * mocked two-browser Playwright journeys. It follows the documented server rules that the web
 * screens depend on — membership and creator checks, 10-minute invite codes, currency matching,
 * date-based participants, equal/exact/percent splits, revisions (409), paid-expense
 * restrictions, individual and monthly payments with the UTC month-end cutoff, settlement checks
 * for leave/remove/archive, audit events without the payer's account, and payer-only accounts —
 * with the server's messages. It is not the server: the real-stack journeys run against .NET.
 * All data is synthetic.
 */
import { equalSplit, percentSplit } from "../../src/features/households/model";

/** A private ledger as `GET`/`PUT /api/ledger` carry it (only the parts the fake checks are typed). */
export interface WireLedger {
  version: number;
  currency: string;
  accounts: { id: string; name: string; type: string }[];
  trips: { id: string; name: string; startDate: string; endDate: string; sharedHouseholdId?: string }[];
  categories: { id: string; name: string; icon: string; color: string; kind: string }[];
  transactions: { id: string; title: string; kind: string; total: number; share: number; categoryId: string; date: string; note: string; tripId?: string; accountId?: string }[];
  recurring: unknown[];
}

export interface FakeResponse {
  status: number;
  body: unknown;
}

interface Period {
  householdId: string;
  userId: string;
  joinedAt: number;
  joinedOn: string;
  leftAt?: number;
}

interface FakeExpense {
  id: string;
  householdId: string;
  title: string;
  totalCents: number;
  date: string;
  payerUserId: string;
  splitMode: "equal" | "exact" | "percent";
  allocations?: ({ userId: string; amountCents: number } | { userId: string; percentBasisPoints: number })[];
  splits: { userId: string; amountCents: number }[];
  category: { name: string; icon: string; color: string };
  note: string;
  accountId?: string;
  revision: number;
  createdBy: string;
  createdAt: number;
  updatedBy: string;
  updatedAt: number;
  recurringId?: string;
  deleted?: boolean;
}

interface FakeRule {
  id: string;
  householdId: string;
  title: string;
  totalCents: number;
  payerUserId: string;
  splitMode: "equal" | "exact" | "percent";
  allocations?: NonNullable<FakeExpense["allocations"]>;
  category: FakeExpense["category"];
  note: string;
  accountId?: string;
  nextDate: string;
  frequency: "weekly" | "monthly" | "yearly";
  anchorDay: number;
  active: boolean;
  revision: number;
}

interface FakeReimbursement {
  id: string;
  householdId: string;
  month: string;
  fromUserId: string;
  toUserId: string;
  amountCents: number;
  createdBy: string;
  createdAt: number;
  expenseId?: string;
}

interface Body {
  [key: string]: unknown;
}

const err = (status: number, error: string): FakeResponse => ({ status, body: { error } });
const ok = (body: unknown, status = 200): FakeResponse => ({ status, body });
const utcDay = (instant: number) => new Date(instant).toISOString().slice(0, 10);

export function createHouseholdServer(options: { now?: () => number } = {}) {
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}${String(++sequence).padStart(4, "0")}`;
  const state = {
    now: options.now ?? (() => Date.now()),
    users: new Map<string, { id: string; currency: string; accounts: { id: string; name: string; type: string }[] }>(),
    households: [] as { id: string; name: string; currency: string; creatorId: string; createdAt: number; archived: boolean; trip?: { startDate: string; endDate: string } }[],
    periods: [] as Period[],
    invites: [] as { code: string; householdId: string; expiresAt: number }[],
    expenses: [] as FakeExpense[],
    rules: [] as FakeRule[],
    reimbursements: [] as FakeReimbursement[],
    audit: [] as { id: string; householdId: string; expenseId?: string; actorId: string; action: string; before: unknown; after: unknown; createdAt: number }[],
    /** Each account's private ledger (MAZ-93 trips), created on first read. */
    ledgers: new Map<string, { revision: number; ledger: WireLedger }>(),
  };

  /** The account's ledger, starting from two expense categories, its currency and accounts. */
  function ledgerOf(email: string) {
    const key = email.toLowerCase();
    let found = state.ledgers.get(key);
    if (!found) {
      const me = user(email);
      found = {
        revision: 1,
        ledger: {
          version: 4,
          currency: me.currency,
          accounts: me.accounts,
          trips: [],
          categories: [
            { id: "c-groceries", name: "Groceries", icon: "basket", color: "#4F9D69", kind: "expense" },
            { id: "c-home", name: "Home", icon: "home", color: "#C27C4E", kind: "expense" },
          ],
          transactions: [],
          recurring: [],
        },
      };
      state.ledgers.set(key, found);
    }
    return found;
  }

  /** A shared trip's name and dates, as the server's schema accepts them, or null (400). */
  function readTrip(body: Body): { name: string; startDate: string; endDate: string } | null {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const real = (value: unknown): value is string =>
      typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= "2000-01-01" && value <= "2100-12-31" && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
    if (!name || name.length > 80 || !real(body.startDate) || !real(body.endDate) || body.endDate < body.startDate) return null;
    return { name, startDate: body.startDate, endDate: body.endDate };
  }

  function user(email: string) {
    const key = email.toLowerCase();
    let found = state.users.get(key);
    if (!found) {
      found = { id: nextId("u"), currency: "CAD", accounts: [] };
      state.users.set(key, found);
    }
    return found;
  }
  const emailOf = (userId: string) => [...state.users].find(([, value]) => value.id === userId)?.[0] ?? "unknown@penny.test";
  const today = () => utcDay(state.now());
  const currentMonth = () => today().slice(0, 7);

  const periodsOf = (householdId: string, userId: string) => state.periods.filter((period) => period.householdId === householdId && period.userId === userId);
  const isCurrentMember = (householdId: string, userId: string) => periodsOf(householdId, userId).some((period) => period.leftAt === undefined);
  const everMember = (householdId: string, userId: string) => periodsOf(householdId, userId).length > 0;
  const currentIds = (householdId: string) => [...new Set(state.periods.filter((period) => period.householdId === householdId && period.leftAt === undefined).map((period) => period.userId))].sort();
  const household = (id: string) => state.households.find((item) => item.id === id);

  function activeOn(householdId: string, date: string): string[] {
    const found = household(householdId);
    if (found?.trip) return currentIds(householdId);
    return [
      ...new Set(
        state.periods.filter((period) => period.householdId === householdId && period.joinedOn <= date && (period.leftAt === undefined || date < utcDay(period.leftAt))).map((period) => period.userId),
      ),
    ].sort();
  }

  function view(found: NonNullable<ReturnType<typeof household>>) {
    return {
      id: found.id,
      name: found.name,
      currency: found.currency,
      creatorId: found.creatorId,
      createdAt: found.createdAt,
      memberCount: currentIds(found.id).length,
      ...(found.trip ? { trip: found.trip } : {}),
    };
  }

  function members(householdId: string) {
    const latest = new Map<string, Period>();
    for (const period of state.periods.filter((item) => item.householdId === householdId)) {
      const previous = latest.get(period.userId);
      if (!previous || period.joinedAt >= previous.joinedAt) latest.set(period.userId, period);
    }
    return [...latest.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt || (a.userId < b.userId ? -1 : 1))
      .map((period) => ({
        userId: period.userId,
        email: emailOf(period.userId),
        joinedAt: period.joinedAt,
        joinedOn: period.joinedOn,
        ...(period.leftAt !== undefined ? { leftAt: period.leftAt } : {}),
      }));
  }

  function expenseView(expense: FakeExpense, viewerId: string) {
    const payments = state.reimbursements
      .filter((item) => item.expenseId === expense.id)
      .map((item) => ({ fromUserId: item.fromUserId, amountCents: item.amountCents, createdAt: item.createdAt, createdBy: item.createdBy }));
    const month = expense.date.slice(0, 7);
    const rest: Partial<FakeExpense> = { ...expense };
    delete rest.deleted;
    delete rest.accountId;
    const { accountId } = expense;
    return {
      ...rest,
      // The payer's private account reaches only the payer.
      ...(accountId && viewerId === expense.payerUserId ? { accountId } : {}),
      payments,
      paymentsClosed: state.reimbursements.some((item) => item.householdId === expense.householdId && item.month === month && !item.expenseId),
    };
  }

  function audit(householdId: string, actorId: string, action: string, before: unknown, after: unknown, expenseId?: string) {
    // Snapshots never carry the payer's private account.
    const strip = (value: unknown) => {
      if (!value || typeof value !== "object") return value ?? null;
      const rest: Body = { ...(value as Body) };
      delete rest.accountId;
      return rest;
    };
    state.audit.push({ id: nextId("a"), householdId, actorId, action, before: strip(before), after: strip(after), createdAt: state.now(), ...(expenseId ? { expenseId } : {}) });
  }

  function computeSplits(totalCents: number, mode: FakeExpense["splitMode"], ids: string[], allocations: FakeExpense["allocations"]): FakeResponse | { userId: string; amountCents: number }[] {
    if (!ids.length) return err(400, "Select distinct members.");
    if (mode === "equal") return equalSplit(totalCents, ids);
    const list = allocations ?? [];
    if (list.length !== ids.length || !ids.every((id) => list.some((item) => item.userId === id))) return err(400, "Provide one split for every eligible member.");
    if (mode === "exact") {
      if (!list.every((item) => "amountCents" in item)) return err(400, "Exact splits need amounts.");
      const shares = list.map((item) => ({ userId: item.userId, amountCents: (item as { amountCents: number }).amountCents })).sort((a, b) => (a.userId < b.userId ? -1 : 1));
      return shares.reduce((sum, item) => sum + item.amountCents, 0) === totalCents ? shares : err(400, "Split shares must add up to the expense total.");
    }
    if (!list.every((item) => "percentBasisPoints" in item)) return err(400, "Percentage splits need percentages.");
    const points = list as { userId: string; percentBasisPoints: number }[];
    if (points.reduce((sum, item) => sum + item.percentBasisPoints, 0) !== 10_000) return err(400, "Split shares must add up to the expense total.");
    return percentSplit(totalCents, points);
  }

  function balances(householdId: string, month: string) {
    const totals = new Map<string, number>();
    const add = (userId: string, cents: number) => totals.set(userId, (totals.get(userId) ?? 0) + cents);
    for (const expense of state.expenses.filter((item) => item.householdId === householdId && !item.deleted && item.date.startsWith(month))) {
      add(expense.payerUserId, expense.totalCents);
      for (const split of expense.splits) add(split.userId, -split.amountCents);
    }
    for (const item of state.reimbursements.filter((row) => row.householdId === householdId && row.month === month)) {
      add(item.fromUserId, item.amountCents);
      add(item.toUserId, -item.amountCents);
    }
    return [...totals].map(([userId, balanceCents]) => ({ userId, balanceCents })).sort((a, b) => (a.userId < b.userId ? -1 : 1));
  }

  function suggestions(rows: { userId: string; balanceCents: number }[]) {
    const order = (a: { userId: string; amount: number }, b: { userId: string; amount: number }) => b.amount - a.amount || (a.userId < b.userId ? -1 : 1);
    const debtors = rows.filter((row) => row.balanceCents < 0).map((row) => ({ userId: row.userId, amount: -row.balanceCents })).sort(order);
    const creditors = rows.filter((row) => row.balanceCents > 0).map((row) => ({ userId: row.userId, amount: row.balanceCents })).sort(order);
    const result: { fromUserId: string; toUserId: string; amountCents: number }[] = [];
    while (debtors.length && creditors.length) {
      const debtor = debtors[0];
      const creditor = creditors[0];
      if (!debtor || !creditor) break;
      const amount = Math.min(debtor.amount, creditor.amount);
      result.push({ fromUserId: debtor.userId, toUserId: creditor.userId, amountCents: amount });
      debtor.amount -= amount;
      creditor.amount -= amount;
      if (debtor.amount === 0) debtors.shift();
      if (creditor.amount === 0) creditors.shift();
      debtors.sort(order);
      creditors.sort(order);
    }
    return result;
  }

  const monthsOf = (householdId: string) =>
    [...new Set([...state.expenses.filter((item) => item.householdId === householdId && !item.deleted).map((item) => item.date.slice(0, 7)), ...state.reimbursements.filter((item) => item.householdId === householdId).map((item) => item.month)])].sort();
  const settled = (householdId: string, userId?: string) =>
    monthsOf(householdId).every((month) => balances(householdId, month).every((row) => (userId === undefined || row.userId === userId ? row.balanceCents === 0 : true)));

  function recap(householdId: string, month: string, viewerId: string) {
    const rows = balances(householdId, month);
    const overdueOf = (value: string) => value < currentMonth() && suggestions(balances(householdId, value)).length > 0;
    return {
      month,
      expenses: state.expenses
        .filter((item) => item.householdId === householdId && !item.deleted && item.date.startsWith(month))
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt))
        .map((item) => expenseView(item, viewerId)),
      reimbursements: state.reimbursements.filter((item) => item.householdId === householdId && item.month === month),
      balances: rows,
      suggestions: suggestions(rows),
      overdue: overdueOf(month),
      overdueMonths: monthsOf(householdId).filter(overdueOf),
    };
  }

  const isDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

  interface ExpenseInput {
    title: string;
    totalCents: number;
    date: string;
    payerUserId: string;
    splitMode: FakeExpense["splitMode"];
    allocations?: NonNullable<FakeExpense["allocations"]>;
    category: FakeExpense["category"];
    note: string;
    accountId?: string;
  }

  function readExpenseInput(body: Body, dateKey: "date" | "nextDate"): ExpenseInput | null {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const total = body.totalCents;
    if (!title || title.length > 100 || typeof total !== "number" || !Number.isSafeInteger(total) || total < 1 || !isDate(body[dateKey]) || typeof body.payerUserId !== "string") return null;
    if (body.splitMode !== "equal" && body.splitMode !== "exact" && body.splitMode !== "percent") return null;
    const category = body.category as FakeExpense["category"] | undefined;
    if (!category || typeof category.name !== "string" || !category.name) return null;
    return {
      title,
      totalCents: total,
      date: body[dateKey],
      payerUserId: body.payerUserId,
      splitMode: body.splitMode,
      ...(Array.isArray(body.allocations) ? { allocations: body.allocations as NonNullable<FakeExpense["allocations"]> } : {}),
      category,
      note: typeof body.note === "string" ? body.note : "",
      ...(typeof body.accountId === "string" ? { accountId: body.accountId } : {}),
    };
  }

  /** Handles one API call as the signed-in `email`. */
  function handle(email: string, method: string, url: string, body: Body = {}): FakeResponse {
    const me = user(email);
    const { pathname, searchParams } = new URL(url, "http://penny.test");
    const parts = pathname.replace(/^\/api\//, "").split("/").map(decodeURIComponent);

    if (pathname === "/api/ledger" && method === "GET") return ok(ledgerOf(email));
    if (pathname === "/api/ledger" && method === "PUT") {
      // Revision-checked like the API (409 on a stale write, never a merge). MAZ-93 trips sync here.
      const current = ledgerOf(email);
      if (body.revision !== current.revision) return err(409, "Ledger revision conflict.");
      const ledger = body.ledger as WireLedger;
      for (const trip of ledger.trips) {
        if (trip.sharedHouseholdId && !household(trip.sharedHouseholdId)) return err(400, "Shared trip not found.");
      }
      const saved = { revision: current.revision + 1, ledger };
      state.ledgers.set(email.toLowerCase(), saved);
      return ok(saved);
    }
    if (parts[0] === "households" && parts[1] === "trips" && parts.length === 2 && method === "POST") {
      const input = readTrip(body);
      if (!input) return err(400, "Invalid household data.");
      if (body.currency !== me.currency) return err(400, "Trip currency must match your ledger currency.");
      const created = { id: nextId("h"), name: input.name, currency: me.currency, creatorId: me.id, createdAt: state.now(), archived: false, trip: { startDate: input.startDate, endDate: input.endDate } };
      state.households.push(created);
      state.periods.push({ householdId: created.id, userId: me.id, joinedAt: state.now(), joinedOn: today() });
      audit(created.id, me.id, "trip.created", null, view(created));
      return ok({ household: view(created) }, 201);
    }
    if (parts[0] !== "households") return err(404, "API route not found.");

    if (parts.length === 1 && method === "GET") {
      const list = state.households.filter((item) => !item.archived && everMember(item.id, me.id)).sort((a, b) => b.createdAt - a.createdAt);
      return ok({ households: list.map(view) });
    }
    if (parts.length === 1 && method === "POST") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name || name.length > 80) return err(400, "Invalid household data.");
      if (body.currency !== me.currency) return err(400, "Household currency must match your ledger currency.");
      const created = { id: nextId("h"), name, currency: me.currency, creatorId: me.id, createdAt: state.now(), archived: false };
      state.households.push(created);
      state.periods.push({ householdId: created.id, userId: me.id, joinedAt: state.now(), joinedOn: today() });
      audit(created.id, me.id, "household.created", null, view(created));
      return ok({ household: view(created) }, 201);
    }
    if (parts[1] === "join" && method === "POST") {
      const code = typeof body.code === "string" ? body.code.toUpperCase() : "";
      if (!/^[A-F0-9]{10}$/.test(code)) return err(400, "Invalid household data.");
      const invite = state.invites.find((item) => item.code === code && item.expiresAt > state.now());
      const target = invite ? household(invite.householdId) : undefined;
      if (!invite || !target || target.archived) return err(400, "Invite code is invalid or expired.");
      if (target.currency !== me.currency) return err(400, "Household currency must match your ledger currency.");
      if (isCurrentMember(target.id, me.id)) return err(409, "You are already a member.");
      state.periods.push({ householdId: target.id, userId: me.id, joinedAt: state.now(), joinedOn: today() });
      audit(target.id, me.id, "member.joined", null, { userId: me.id });
      return ok({ household: view(target) });
    }

    const found = household(parts[1] ?? "");
    if (!found || !everMember(found.id, me.id)) return err(404, "Household not found.");
    const current = isCurrentMember(found.id, me.id);
    const writable = current && !found.archived;
    const creator = found.creatorId === me.id;

    if (parts.length === 2 && method === "GET") return ok({ household: view(found), members: members(found.id) });
    if (parts[2] === "trip" && parts.length === 3 && method === "PATCH") {
      if (!writable) return err(404, "Household not found.");
      if (!creator) return err(403, "Only the household creator can manage members.");
      const input = readTrip(body);
      if (!input) return err(400, "Invalid household data.");
      if (!found.trip) return err(404, "Trip not found.");
      const before = view(found);
      found.name = input.name;
      found.trip = { startDate: input.startDate, endDate: input.endDate };
      audit(found.id, me.id, "trip.edited", before, view(found));
      return ok({ household: view(found) });
    }
    if (parts.length === 2 && method === "PATCH") {
      if (!writable) return err(404, "Household not found.");
      if (!creator) return err(403, "Only the household creator can manage members.");
      const before = view(found);
      found.name = String(body.name).trim();
      audit(found.id, me.id, "household.renamed", before, view(found));
      return ok({ household: view(found) });
    }
    if (parts[2] === "invites" && method === "POST") {
      if (!writable) return err(404, "Household not found.");
      if (!creator) return err(403, "Only the household creator can manage members.");
      state.invites = state.invites.filter((item) => item.householdId !== found.id);
      const code = Array.from({ length: 10 }, (_, index) => "0123456789ABCDEF"[(sequence * 7 + index * 5) % 16]).join("");
      const invite = { code, householdId: found.id, expiresAt: state.now() + 10 * 60_000 };
      state.invites.push(invite);
      audit(found.id, me.id, "invite.created", null, { expiresAt: invite.expiresAt });
      return ok({ code: invite.code, expiresAt: invite.expiresAt }, 201);
    }
    if (parts[2] === "leave" && method === "POST") {
      if (!writable) return err(404, "Household not found.");
      if (creator && currentIds(found.id).length > 1) return err(409, "The creator cannot leave while other members remain.");
      if (!settled(found.id, me.id)) return err(409, "Settle every monthly balance before leaving.");
      for (const period of periodsOf(found.id, me.id)) if (period.leftAt === undefined) period.leftAt = state.now();
      audit(found.id, me.id, "member.left", { userId: me.id }, null);
      return ok({ ok: true });
    }
    if (parts[2] === "members" && method === "DELETE") {
      const target = parts[3] ?? "";
      if (!writable) return err(404, "Household not found.");
      if (!creator) return err(403, "Only the household creator can manage members.");
      if (target === me.id) return err(400, "The creator cannot remove themselves.");
      if (!isCurrentMember(found.id, target)) return err(404, "Household not found.");
      if (!settled(found.id, target)) return err(409, "Settle every monthly balance before leaving.");
      for (const period of periodsOf(found.id, target)) if (period.leftAt === undefined) period.leftAt = state.now();
      audit(found.id, me.id, "member.removed", { userId: target }, null);
      return ok({ ok: true });
    }
    if (parts[2] === "archive" && method === "POST") {
      if (!writable) return err(404, "Household not found.");
      if (!creator) return err(403, "Only the household creator can manage members.");
      if (!settled(found.id)) return err(409, "Settle all monthly balances before archiving.");
      found.archived = true;
      state.invites = state.invites.filter((item) => item.householdId !== found.id);
      audit(found.id, me.id, "household.archived", null, { householdId: found.id });
      return ok({ ok: true });
    }

    if (parts[2] === "expenses") {
      const expenseId = parts[3];
      const visible = (expense: FakeExpense) => current || expense.splits.some((split) => split.userId === me.id);
      if (!expenseId && method === "GET") {
        const month = searchParams.get("month");
        const list = state.expenses.filter((item) => item.householdId === found.id && !item.deleted && visible(item) && (!month || item.date.startsWith(month)));
        return ok({ expenses: list.map((item) => expenseView(item, me.id)) });
      }
      if (!expenseId && method === "POST") {
        if (!writable) return err(404, "Household not found.");
        const input = readExpenseInput(body, "date");
        if (!input) return err(400, "Invalid household data.");
        const eligible = activeOn(found.id, input.date);
        if (!eligible.includes(input.payerUserId)) return err(400, "The payer must be a current household member.");
        if (input.accountId && input.payerUserId !== me.id) return err(403, "Only the payer can attach a payment account.");
        const splits = computeSplits(input.totalCents, input.splitMode, eligible, input.allocations);
        if (!Array.isArray(splits)) return splits;
        const expense: FakeExpense = {
          id: nextId("e"),
          householdId: found.id,
          ...input,
          splits,
          revision: 0,
          createdBy: me.id,
          createdAt: state.now(),
          updatedBy: me.id,
          updatedAt: state.now(),
        };
        state.expenses.push(expense);
        audit(found.id, me.id, "expense.created", null, expenseView(expense, ""), expense.id);
        return ok({ expense: expenseView(expense, me.id) }, 201);
      }
      const expense = state.expenses.find((item) => item.id === expenseId && item.householdId === found.id && !item.deleted);
      if (parts[4] === "payments" && method === "POST") {
        if (typeof body.fromUserId !== "string" || typeof body.revision !== "number") return err(400, "Invalid household data.");
        if (!writable) return err(404, "Household not found.");
        if (!expense) return err(404, "Expense not found.");
        if (me.id !== body.fromUserId && me.id !== expense.payerUserId) return err(403, "Only the debtor or expense payer can record this payment.");
        if (body.fromUserId === expense.payerUserId) return err(400, "The payer cannot pay their own share.");
        if (expense.revision !== body.revision) return err(409, "Expense changed. Refresh and try again.");
        const month = expense.date.slice(0, 7);
        if (state.reimbursements.some((item) => item.householdId === found.id && item.month === month && !item.expenseId)) {
          return err(409, "This month already has monthly reimbursements. Settle the remaining monthly balance instead.");
        }
        if (state.reimbursements.some((item) => item.expenseId === expense.id && item.fromUserId === body.fromUserId)) return err(409, "This share is already paid.");
        const share = expense.splits.find((split) => split.userId === body.fromUserId)?.amountCents ?? 0;
        if (share <= 0) return err(400, "Choose a member with a positive share.");
        const payment = { id: nextId("r"), householdId: found.id, month, fromUserId: body.fromUserId, toUserId: expense.payerUserId, amountCents: share, createdBy: me.id, createdAt: state.now(), expenseId: expense.id };
        state.reimbursements.push(payment);
        expense.revision += 1;
        audit(found.id, me.id, "reimbursement.created", null, payment, expense.id);
        return ok({ expense: expenseView(expense, me.id) }, 201);
      }
      if (method === "GET") {
        if (!expense || !visible(expense)) return err(404, "Expense not found.");
        return ok({ expense: expenseView(expense, me.id) });
      }
      if (method === "PUT") {
        if (!writable) return err(404, "Household not found.");
        const input = readExpenseInput(body, "date");
        if (!input || typeof body.revision !== "number") return err(400, "Invalid household data.");
        if (!expense) return err(404, "Expense not found.");
        if (expense.revision !== body.revision) return err(409, "Expense changed. Refresh and try again.");
        const paid = state.reimbursements.some((item) => item.expenseId === expense.id);
        if (paid && (input.payerUserId !== expense.payerUserId || input.totalCents !== expense.totalCents || input.date.slice(0, 7) !== expense.date.slice(0, 7))) {
          return err(409, "Paid expenses cannot change payer, total, month or household.");
        }
        const eligible = paid ? expense.splits.map((split) => split.userId) : activeOn(found.id, input.date);
        if (!eligible.includes(input.payerUserId)) return err(400, "The payer must be a current household member.");
        if (input.accountId && input.payerUserId !== me.id) return err(403, "Only the payer can attach a payment account.");
        const splits = computeSplits(input.totalCents, input.splitMode, eligible, input.allocations);
        if (!Array.isArray(splits)) return splits;
        if (paid && JSON.stringify(splits) !== JSON.stringify(expense.splits)) return err(409, "Paid expenses cannot change share allocations.");
        const before = expenseView(expense, "");
        // Another member's edit keeps the payer's account; the payer's own edit sets or clears it.
        const accountId = me.id === input.payerUserId ? input.accountId : input.payerUserId === expense.payerUserId ? expense.accountId : undefined;
        Object.assign(expense, { ...input, splits, revision: expense.revision + 1, updatedBy: me.id, updatedAt: state.now() });
        if (accountId) expense.accountId = accountId;
        else delete expense.accountId;
        if (!input.allocations) delete expense.allocations;
        audit(found.id, me.id, "expense.updated", before, expenseView(expense, ""), expense.id);
        return ok({ expense: expenseView(expense, me.id) });
      }
      if (method === "DELETE") {
        if (!writable) return err(404, "Household not found.");
        if (typeof body.revision !== "number") return err(400, "Invalid household data.");
        if (!expense) return err(404, "Expense not found.");
        if (expense.revision !== body.revision) return err(409, "Expense changed. Refresh and try again.");
        if (state.reimbursements.some((item) => item.expenseId === expense.id)) return err(409, "Paid expenses cannot be deleted.");
        expense.deleted = true;
        expense.revision += 1;
        audit(found.id, me.id, "expense.deleted", expenseView(expense, ""), null, expense.id);
        return ok({ ok: true });
      }
    }

    if (parts[2] === "months" && parts[3]) {
      const month = parts[3];
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return err(400, "Invalid household data.");
      if (parts[4] === "reimbursements" && method === "POST") {
        if (!writable) return err(404, "Household not found.");
        const { fromUserId, toUserId, amountCents } = body as { fromUserId: string; toUserId: string; amountCents: number };
        if (fromUserId === toUserId) return err(400, "Choose two different members.");
        if (me.id !== fromUserId && me.id !== toUserId) return err(403, "Only people involved can record a reimbursement.");
        const [year = 2000, number = 1] = month.split("-").map(Number);
        const last = `${month}-${String(new Date(Date.UTC(year, number, 0)).getUTCDate()).padStart(2, "0")}`;
        if (today() < last) return err(409, "Record reimbursements on the last day of the month or later.");
        const match = suggestions(balances(found.id, month)).some((item) => item.fromUserId === fromUserId && item.toUserId === toUserId && item.amountCents === amountCents);
        if (!match) return err(409, "This is no longer the full suggested reimbursement.");
        const reimbursement = { id: nextId("r"), householdId: found.id, month, fromUserId, toUserId, amountCents, createdBy: me.id, createdAt: state.now() };
        state.reimbursements.push(reimbursement);
        audit(found.id, me.id, "reimbursement.created", null, reimbursement);
        return ok({ reimbursement }, 201);
      }
      if (method === "GET") return ok(recap(found.id, month, me.id));
    }

    if (parts[2] === "audit" && method === "GET") {
      const expenseId = searchParams.get("expenseId");
      const events = state.audit.filter((item) => item.householdId === found.id && (!expenseId || item.expenseId === expenseId)).reverse();
      return ok({ events });
    }

    if (parts[2] === "recurring") {
      const ruleId = parts[3];
      if (!ruleId && method === "GET") return ok({ rules: current ? state.rules.filter((rule) => rule.householdId === found.id) : [] });
      if (!writable) return err(404, "Household not found.");
      if (!ruleId && method === "POST") {
        const input = readExpenseInput(body, "nextDate");
        if (!input || (body.frequency !== "weekly" && body.frequency !== "monthly" && body.frequency !== "yearly")) return err(400, "Invalid household data.");
        if (!currentIds(found.id).includes(input.payerUserId)) return err(400, "Payer must be a current member.");
        const splits = computeSplits(input.totalCents, input.splitMode, currentIds(found.id), input.allocations);
        if (!Array.isArray(splits)) return splits;
        const { date, ...rest } = input;
        const rule: FakeRule = { id: nextId("rule"), householdId: found.id, ...rest, nextDate: date, frequency: body.frequency, anchorDay: Number(date.slice(8)), active: true, revision: 0 };
        state.rules.push(rule);
        audit(found.id, me.id, "recurring.created", null, rule);
        return ok({ rule }, 201);
      }
      const rule = state.rules.find((item) => item.id === ruleId && item.householdId === found.id);
      if (!rule) return err(404, "Recurring rule not found.");
      if (body.revision !== rule.revision) return err(409, "Recurring rule changed. Refresh and try again.");
      if (method === "DELETE") {
        state.rules = state.rules.filter((item) => item !== rule);
        audit(found.id, me.id, "recurring.deleted", { id: rule.id, title: rule.title, revision: rule.revision }, null);
        return ok({ ok: true });
      }
      if (method === "PUT") {
        const input = readExpenseInput(body, "nextDate");
        if (!input) return err(400, "Invalid household data.");
        const before = { id: rule.id, title: rule.title, active: rule.active, revision: rule.revision };
        const { date, ...rest } = input;
        Object.assign(rule, { ...rest, nextDate: date, frequency: body.frequency, active: body.active === true, revision: rule.revision + 1 });
        if (!input.accountId) delete rule.accountId;
        audit(found.id, me.id, "recurring.updated", before, rule);
        return ok({ rule });
      }
    }
    return err(404, "API route not found.");
  }

  return {
    state,
    handle,
    /** The id the fake gave an account (accounts appear on first use). */
    userId: (email: string) => user(email).id,
    setLedger: (email: string, ledger: { currency?: string; accounts?: { id: string; name: string; type: string }[] }) => Object.assign(user(email), ledger),
    /** The account's private ledger as the server holds it (read or seeded before the browser loads it). */
    ledger: (email: string) => ledgerOf(email),
    /** Another device writes to the account's ledger: the change lands with a new revision. */
    writeLedger: (email: string, change: (ledger: WireLedger) => WireLedger) => {
      const current = ledgerOf(email);
      state.ledgers.set(email.toLowerCase(), { revision: current.revision + 1, ledger: change(current.ledger) });
    },
    /** Pretends a 10-minute invite was created long ago, so it has expired. */
    expireInvites: () => {
      for (const invite of state.invites) invite.expiresAt = state.now() - 1;
    },
  };
}

export type HouseholdServer = ReturnType<typeof createHouseholdServer>;
