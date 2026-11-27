import { crossRate } from "@domain/currency.ts";
import { initialCategories } from "@domain/ledger.ts";
import { yearReviewYear } from "@domain/yearReview.ts";
import type { Transport } from "../api/client";
import type { ReceiptUploadBody } from "../api/receipts";
import type { SearchItem, SearchRequest } from "../api/schemas";

/** The demo account. `.invalid` can never be a real address, so its cache keys never collide. */
export const DEMO_EMAIL = "demo@penny.invalid";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const pad = (value: number) => String(value).padStart(2, "0");
const dateKey = (date: Date) => `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

type Kind = "income" | "expense" | "investment";
interface DemoEntry {
  id: string;
  title: string;
  kind: Kind;
  total: number;
  share: number;
  participants?: number;
  categoryId: string;
  date: string;
  note: string;
  tripId?: string;
}

/** Sample month: made-up names and amounts, no real data. */
export function sampleEntries(today = new Date()): DemoEntry[] {
  const day = today.getDate();
  const on = (offset: number) => dateKey(new Date(today.getFullYear(), today.getMonth(), Math.max(1, day - offset)));
  const rows: [string, number, string, number, number?, Kind?][] = [
    ["Monthly salary", 480000, "salary", 20, 480000, "income"],
    ["Rent", 145000, "home", 20],
    ["Weekly groceries", 8642, "groceries", 0],
    ["Coffee with a friend", 1240, "food", 0, 620],
    ["Dinner out", 14880, "food", 1, 7440],
    ["Monthly transit pass", 15600, "transport", 5],
    ["A new read", 2499, "shopping", 2],
    ["Weekend groceries", 7235, "groceries", 6],
    ["Design project", 65000, "freelance", 8, 65000, "income"],
    ["Index fund", 20000, "investments", 10, 20000, "investment"],
    ["Music streaming", 1299, "fun", 3],
  ];
  const entry = ([title, total, categoryId, share = total, kind = "expense"]: [string, number, string, (number | undefined)?, (Kind | undefined)?], id: string, date: string): DemoEntry => ({
    id,
    title,
    kind,
    total,
    share,
    // Half of the total: split equally between two people, so Recent says "split 2 ways" (MAZ-272).
    ...(kind === "expense" && share * 2 === total ? { participants: 2 } : {}),
    categoryId,
    date,
    note: "",
  });
  const month = rows.map(([title, total, categoryId, offset, share, kind], index) => entry([title, total, categoryId, share, kind], `demo-${String(index + 1)}`, on(offset)));
  const history = [...sampleHistory(), ...sampleYear(today)].flatMap(({ monthsAgo, rows: past }) =>
    past.map(([day, ...rest], index) => entry(rest, `demo-m${String(monthsAgo)}-${String(index + 1)}`, dateKey(new Date(today.getFullYear(), today.getMonth() - monthsAgo, day)))),
  );
  return [...month, ...history, ...skiEntries(today)];
}

/**
 * The two months before this one (MAZ-292), so the demo has a monthly recap to show: last month
 * compared with the month before. Made-up amounts; each row is [day, title, total, category,
 * share, kind].
 */
function sampleHistory(): { monthsAgo: number; rows: [number, string, number, string, number?, Kind?][] }[] {
  return [
    {
      monthsAgo: 1,
      rows: [
        [15, "Paycheque", 480000, "salary", 480000, "income"],
        [1, "Apartment rent", 145000, "home"],
        [2, "Transit pass", 15600, "transport"],
        [3, "Streaming plan", 1299, "fun"],
        [4, "Grocery run", 9120, "groceries"],
        [9, "Dinner with friends", 13200, "food", 6600],
        [10, "Index fund top-up", 20000, "investments", 20000, "investment"],
        [18, "Farmers’ market", 6840, "groceries"],
        [22, "Concert tickets", 8900, "fun", 4450],
        [25, "A warm jacket", 7400, "shopping"],
      ],
    },
    {
      monthsAgo: 2,
      rows: [
        [15, "Paycheque", 480000, "salary", 480000, "income"],
        [1, "Apartment rent", 145000, "home"],
        [2, "Transit pass", 15600, "transport"],
        [3, "Streaming plan", 1299, "fun"],
        [6, "Grocery run", 10450, "groceries"],
        [10, "Index fund top-up", 20000, "investments", 20000, "investment"],
        [12, "Lunch with a colleague", 9800, "food", 4900],
        [20, "Farmers’ market", 7310, "groceries"],
      ],
    },
  ];
}

/**
 * The year the demo's year in review covers (MAZ-292 phase 2): the year offered from December 26
 * to January 31 (`yearReviewYear`), else none.
 */
const reviewYear = (today: Date) => {
  const year = yearReviewYear(dateKey(today));
  return year ? Number(year) : null;
};

/**
 * The rest of the review year (MAZ-292 phase 2), so the demo's year in review has something to
 * show from December 26 to January 31 (outside that window the demo keeps its three months, which
 * the monthly recap's first-month checks rely on): every month from January up to three months ago, made-up amounts that vary a little by
 * month, with a ski weekend in February. Each row is [day, title, total, category, share, kind].
 * It stops three months back so the monthly recap still compares last month with the month
 * before alone, and never reaches the same month last year.
 */
function sampleYear(today: Date): { monthsAgo: number; rows: [number, string, number, string, number?, Kind?][] }[] {
  const months: { monthsAgo: number; rows: [number, string, number, string, number?, Kind?][] }[] = [];
  if (reviewYear(today) === null) return months;
  for (let monthsAgo = 3; ; monthsAgo += 1) {
    const date = new Date(today.getFullYear(), today.getMonth() - monthsAgo, 1);
    if (date.getFullYear() !== reviewYear(today)) break;
    const month = date.getMonth();
    const vary = (base: number, step: number) => base + ((month * 7) % 5) * step;
    const rows: [number, string, number, string, number?, Kind?][] = [
      [15, "Paycheque", 480000, "salary", 480000, "income"],
      [1, "Apartment rent", 145000, "home"],
      [2, "Transit pass", 15600, "transport"],
      [3, "Streaming plan", 1299, "fun"],
      [5, "Grocery run", vary(8800, 640), "groceries"],
      [10, "Index fund top-up", 20000, "investments", 20000, "investment"],
      [19, "Farmers’ market", vary(6200, 410), "groceries"],
      [month % 2 ? 12 : 26, "Dinner with friends", vary(11800, 900), "food", vary(11800, 900) / 2],
    ];
    if (month % 3 === 1) rows.push([22, "New running shoes", vary(9400, 1200), "shopping"]);
    if (month === 5 || month === 11) rows.push([24, "Concert tickets", 12400, "fun", 6200]);
    months.push({ monthsAgo, rows });
  }
  return months;
}

/** A made-up personal trip (MAZ-93) starting in 12 days, and the year's ski weekend in February (MAZ-292). The demo has no shared trips. */
export function sampleTrips(today = new Date()) {
  const at = (offset: number) => dateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset));
  const year = reviewYear(today);
  const trips = [{ id: "demo-trip", name: "Weekend in Québec City", startDate: at(12), endDate: at(14) }];
  // Only once February is three months back, so it lands in the year's history.
  if (sampleYear(today).some(({ monthsAgo }) => new Date(today.getFullYear(), today.getMonth() - monthsAgo, 1).getMonth() === 1)) {
    trips.push({ id: "demo-ski", name: "Ski weekend", startDate: `${String(year)}-02-13`, endDate: `${String(year)}-02-15` });
  }
  return trips;
}

/** The ski weekend's entries (MAZ-292 phase 2), on the February trip when there is one. */
function skiEntries(today: Date): DemoEntry[] {
  if (!sampleTrips(today).some((trip) => trip.id === "demo-ski")) return [];
  const year = String(reviewYear(today));
  const entry = (id: string, title: string, total: number, categoryId: string, day: string): DemoEntry => ({ id, title, kind: "expense", total, share: total, categoryId, date: `${year}-02-${day}`, note: "", tripId: "demo-ski" });
  return [entry("demo-ski-1", "Lift tickets", 18600, "fun", "13"), entry("demo-ski-2", "Cabin", 32000, "home", "13"), entry("demo-ski-3", "Fondue night", 7400, "food", "14")];
}

/**
 * Two schedules due on the month's last day (MAZ-92), so the demo's Home shows a projected
 * remaining with expected recurring income and something coming up. Previews only: the demo never
 * records them.
 */
export function sampleSchedules(today = new Date()) {
  const last = dateKey(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  const anchorDay = Number(last.slice(8));
  const rule = (id: string, title: string, kind: Kind, total: number, categoryId: string) => ({
    id, title, kind, total, share: total, categoryId, date: last, note: "", frequency: "monthly", nextDate: last, anchorDay, active: true,
  });
  return [rule("demo-rule-1", "Design retainer", "income", 40000, "freelance"), rule("demo-rule-2", "Phone plan", "expense", 4500, "other")];
}

/**
 * Made-up reference rates, per euro, for the demo's `GET /api/rates` (MAZ-151): the cards' sample
 * values (1 EUR = 1.4612 CAD). The same every day, published every weekday before today, so an
 * entry dated today is provisional, as on a real server before the day's rates are out.
 */
const DEMO_PER_EURO: Record<string, string> = { EUR: "1", CAD: "1.4612", USD: "1.0642", GBP: "0.8721", JPY: "163.21", CHF: "0.9412", AUD: "1.642", MXN: "21.43" };

export function demoRates(base: string, date: string, today = new Date()) {
  const latest = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  while (latest.getDay() === 0 || latest.getDay() === 6) latest.setDate(latest.getDate() - 1);
  const latestDate = dateKey(latest);
  const day = new Date(`${date}T12:00:00`);
  while (day.getDay() === 0 || day.getDay() === 6) day.setDate(day.getDate() - 1);
  const provisional = date > latestDate;
  const rateDate = provisional ? latestDate : dateKey(day);
  const home = DEMO_PER_EURO[base];
  const rates: Record<string, string> = {};
  if (home)
    for (const [code, perEuro] of Object.entries(DEMO_PER_EURO)) {
      const rate = code === base ? null : crossRate(perEuro, home);
      if (rate) rates[code] = rate;
    }
  return { enabled: true, source: "European Central Bank", base, date, rateDate, provisional, latestDate, rates };
}

/** The demo household (MAZ-283): made-up people and amounts, so Together lists one, as `web-demo` draws. */
export const DEMO_HOUSEHOLD_ID = "demo-household";
const DEMO_ME = "demo-user";
const DEMO_HOUSEMATE = "demo-housemate";
/** Someone who shared the apartment early in the year and has since deleted their account. */
const DEMO_FORMER = "demo-former";

/**
 * The household, its two members and this month's two shared expenses, split equally: you paid
 * for cleaning supplies, your housemate paid the internet. Read-only: writes answer 404 like any other
 * route the demo doesn't have.
 */
export function sampleHousehold(today = new Date()) {
  const month = dateKey(today).slice(0, 7);
  const on = (offset: number) => dateKey(new Date(today.getFullYear(), today.getMonth(), Math.max(1, today.getDate() - offset)));
  const created = new Date(today.getFullYear(), today.getMonth() - 3, 1).getTime();
  const household = { id: DEMO_HOUSEHOLD_ID, name: "Apartment", currency: "CAD" as const, creatorId: DEMO_ME, createdAt: created, memberCount: 2 };
  const members = [
    { userId: DEMO_ME, email: DEMO_EMAIL, joinedAt: created },
    { userId: DEMO_HOUSEMATE, email: "housemate@penny.invalid", displayName: "Jules Moreau", joinedAt: created },
  ];
  const expense = (id: string, title: string, totalCents: number, payerUserId: string, category: { name: string; icon: string; color: string }, date: string) => ({
    id,
    householdId: DEMO_HOUSEHOLD_ID,
    title,
    totalCents,
    payerUserId,
    splitMode: "equal" as const,
    category,
    note: "",
    date,
    splits: [
      { userId: DEMO_ME, amountCents: totalCents / 2 },
      { userId: DEMO_HOUSEMATE, amountCents: totalCents / 2 },
    ],
    revision: 0,
    createdBy: payerUserId,
    createdAt: created,
    updatedBy: payerUserId,
    updatedAt: created,
    payments: [],
    paymentsClosed: false,
  });
  const expenses = [
    expense("demo-shared-1", "Cleaning supplies", 8400, DEMO_ME, { name: "Household", icon: "bag-handle-outline", color: "#9D83BA" }, on(2)),
    expense("demo-shared-2", "Internet", 6000, DEMO_HOUSEMATE, { name: "Utilities", icon: "wifi-outline", color: "#678DB1" }, on(4)),
  ];
  // The year's earlier shared expenses (MAZ-292 phase 2), for the year in review's Who paid: the
  // projection lists them; the household's own pages keep showing this month's two only.
  const past = sampleYear(today).flatMap(({ monthsAgo }, index) => {
    const at = (day: number) => dateKey(new Date(today.getFullYear(), today.getMonth() - monthsAgo, day));
    const rows = [expense(`demo-shared-m${String(monthsAgo)}-1`, "Internet", 6000, DEMO_HOUSEMATE, { name: "Utilities", icon: "wifi-outline", color: "#678DB1" }, at(4))];
    if (index % 2 === 0) rows.push(expense(`demo-shared-m${String(monthsAgo)}-2`, "Cleaning supplies", 7600, DEMO_ME, { name: "Household", icon: "bag-handle-outline", color: "#9D83BA" }, at(8)));
    if (index % 3 === 1) rows.push(expense(`demo-shared-m${String(monthsAgo)}-3`, "Takeout night", 5400, DEMO_ME, { name: "Food & drinks", icon: "cafe-outline", color: "#E47850" }, at(17)));
    if (index === 4) rows.push(expense(`demo-shared-m${String(monthsAgo)}-4`, "Hardware store", 4200, DEMO_FORMER, { name: "Household", icon: "bag-handle-outline", color: "#9D83BA" }, at(20)));
    return rows;
  });
  // You paid 84.00 of supplies and owe 30.00 of the internet: your housemate owes you 12.00 this month.
  const mine = expenses.reduce((sum, item) => sum + (item.payerUserId === DEMO_ME ? item.totalCents : 0) - item.totalCents / 2, 0);
  return { month, household, members, expenses, past, balance: mine };
}

/**
 * An in-memory stand-in for the parts of the API the web app uses, for the temporary demo. It
 * keeps the API's rules that matter to the UI (revision conflicts, cursor paging) and answers
 * everything else with 404, so a screen that needs a real server says so instead of guessing.
 */
export function createDemoServer(today = new Date()): Transport {
  const state = {
    revision: 1,
    ledger: {
      version: 4,
      currency: "CAD",
      accounts: [],
      trips: sampleTrips(today),
      // The default categories, so the demo's categories have names, colors and icons.
      categories: initialCategories.map((category) => ({ ...category })),
      // Dinner out goes on the sample trip, dated before it: expenses outside the dates still count.
      transactions: sampleEntries(today).map((entry) => (entry.id === "demo-5" ? { ...entry, tripId: "demo-trip" } : entry)),
      recurring: sampleSchedules(today),
    } as Record<string, unknown> & { transactions: DemoEntry[] },
  };

  function search(request: SearchRequest) {
    const query = request.query?.trim().toLowerCase();
    const matches = state.ledger.transactions
      .filter((entry) => !query || entry.title.toLowerCase().includes(query))
      .filter((entry) => (!request.from || entry.date >= request.from) && (!request.to || entry.date <= request.to))
      .filter((entry) => !request.kind || entry.kind === request.kind)
      .filter(() => request.source !== "shared")
      .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    const start = request.cursor ? Number(request.cursor) : 0;
    const size = request.pageSize ?? 50;
    const page = matches.slice(start, start + size);
    const items: SearchItem[] = page.map((entry) => ({ key: `personal:${entry.id}`, source: "personal", match: query ? "title" : null, entry }));
    const next = start + size < matches.length ? String(start + size) : null;
    return { version: 1, items, totalCount: matches.length, nextCursor: next };
  }

  // The sample household (MAZ-283): the list, the projection of your shares, the detail, the month's
  // recap and the expenses. Anything else under /api/households answers 404.
  const home = sampleHousehold(today);
  function households(path: string): Response | null {
    const [route = "", query = ""] = path.split("?");
    const params = new URLSearchParams(query);
    const inPeriod = (date: string) => (params.get("month") ? date.startsWith(`${params.get("month") ?? ""}-`) : params.get("year") ? date.startsWith(`${params.get("year") ?? ""}-`) : true);
    if (route === "/api/households") return json({ households: [home.household] });
    if (route === "/api/households/projection") {
      const payerOf = (userId: string) => {
        if (userId === DEMO_FORMER) return { email: "deleted@penny.invalid", deleted: true as const };
        const { email, displayName } = home.members.find((member) => member.userId === userId) ?? { email: "", displayName: undefined };
        return displayName ? { email, displayName } : { email };
      };
      const transactions = [...home.expenses, ...home.past]
        .filter((item) => inPeriod(item.date))
        .map((item) => ({
          id: item.id,
          householdId: item.householdId,
          householdName: home.household.name,
          householdCurrency: home.household.currency,
          title: item.title,
          date: item.date,
          totalCents: item.totalCents,
          shareCents: item.totalCents / 2,
          payerUserId: item.payerUserId,
          payer: payerOf(item.payerUserId),
          paidByYou: item.payerUserId === DEMO_ME,
          category: item.category,
          note: item.note,
        }));
      return json({ transactions, scheduled: [] });
    }
    const base = `/api/households/${DEMO_HOUSEHOLD_ID}`;
    if (route === base) return json({ household: home.household, members: home.members });
    if (route === `${base}/expenses`) return json({ expenses: home.expenses });
    if (route.startsWith(`${base}/expenses/`)) {
      const found = home.expenses.find((item) => route === `${base}/expenses/${item.id}`);
      return found ? json({ expense: found }) : null;
    }
    if (route === `${base}/recurring`) return json({ rules: [] });
    if (route === `${base}/audit`) return json({ events: [] });
    const month = /^\/months\/(\d{4}-\d{2})$/.exec(route.slice(base.length))?.[1];
    if (month) {
      const current = month === home.month;
      const balance = current ? home.balance : 0;
      return json({
        month,
        expenses: current ? home.expenses : [],
        reimbursements: [],
        balances: [
          { userId: DEMO_ME, balanceCents: balance },
          { userId: DEMO_HOUSEMATE, balanceCents: -balance },
        ],
        suggestions: balance > 0 ? [{ fromUserId: DEMO_HOUSEMATE, toUserId: DEMO_ME, amountCents: balance }] : [],
        overdue: false,
        overdueMonths: [],
      });
    }
    return null;
  }

  // Receipts uploaded in the demo (MAZ-94): kept in this tab's memory only, like everything else.
  const receipts = new Map<string, { name: string; mime: string; bytes: Uint8Array<ArrayBuffer> }>();
  async function receipt(path: string, method: string, body: unknown): Promise<Response | null> {
    if (method === "POST" && path === "/api/receipts") {
      const upload = body as ReceiptUploadBody;
      const id = `demo-receipt-${String(receipts.size + 1)}`;
      receipts.set(id, { name: upload.name, mime: upload.mime, bytes: new Uint8Array(await upload.file.arrayBuffer()) });
      return json({ id, name: upload.name, mime: upload.mime, uri: `/api/receipts/${id}` }, 201);
    }
    const stored = method === "GET" && path.startsWith("/api/receipts/") ? receipts.get(path.slice("/api/receipts/".length)) : undefined;
    return stored ? new Response(stored.bytes, { status: 200, headers: { "Content-Type": stored.mime } }) : null;
  }

  return async (path, { method, body, signal }) => {
    // Answer asynchronously, like a network, so loading states and aborts behave the same.
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (signal?.aborted) throw new DOMException("The request was aborted.", "AbortError");
    const stored = await receipt(path, method, body);
    if (stored) return stored;

    const shared = method === "GET" ? households(path) : null;
    if (shared) return shared;

    if (method === "GET" && path.startsWith("/api/rates?")) {
      const params = new URLSearchParams(path.slice("/api/rates?".length));
      const base = params.get("base") ?? "";
      const date = params.get("date") ?? dateKey(today);
      if (!(base in DEMO_PER_EURO) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "Invalid exchange rate request.", code: "rates.invalid_request" }, 400);
      return json(demoRates(base, date, today));
    }

    const route = `${method} ${path}`;
    switch (route) {
      case "GET /api/info":
        return json({ name: "penny", version: "demo" });
      case "GET /api/auth/me":
        return json({ email: DEMO_EMAIL });
      case "GET /api/auth/oidc":
        return json({ enabled: false, providers: [] });
      case "POST /api/auth/logout":
        return json({ ok: true });
      case "GET /api/ledger":
        return json(state);
      case "PUT /api/ledger": {
        const next = body as { revision: number; ledger: typeof state.ledger };
        if (next.revision !== state.revision) return json({ error: "The ledger changed.", code: "ledger.conflict" }, 409);
        state.revision += 1;
        state.ledger = next.ledger;
        return json(state);
      }
      case "POST /api/v1/search/transactions":
        return json(search(body as SearchRequest));
      default:
        return json({ error: "This isn't available in the demo." }, 404);
    }
  };
}
