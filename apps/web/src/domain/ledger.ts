import type { RateStatus } from "./currency.ts";
export type Kind = "expense" | "income" | "investment";
export const kinds: Kind[] = ["expense", "income", "investment"];
export const kindLabels: Record<Kind, string> = {
  expense: "Expense", income: "Income", investment: "Investment",
};
export type Frequency = "weekly" | "monthly" | "yearly";
export const accountTypes = ["bank", "credit", "cash", "other"] as const;
export type AccountType = typeof accountTypes[number];
export const accountTypeLabels: Record<AccountType, string> = {
  bank: "Bank account", credit: "Credit card", cash: "Cash", other: "Other",
};
export const accountTypeIcons: Record<AccountType, string> = {
  bank: "business-outline", credit: "card-outline", cash: "cash-outline", other: "wallet-outline",
};
export type PaymentAccount = { id: string; name: string; type: AccountType };
export type Trip = {
  id: string; name: string; startDate: string; endDate: string; sharedHouseholdId?: string;
  /** Contract 2.6.0 (MAZ-151 phase 2): the default currency of the trip's new entries. */
  currency?: string;
};
export type Category = {
  id: string;
  name: string;
  icon: string;
  color: string;
  kind: Kind;
};
export type Receipt = { id: string; name: string; uri: string; mime: string; };
export type Transaction = {
  id: string;
  title: string;
  kind: Kind;
  total: number;
  share: number;
  // How many people split an expense, the person included (2–100). An equal split sets it, so Home
  // can say "split N ways"; absent when the entry isn't split or was split by amount or percent.
  // Optional (contract 2.2.0), so older clients and ledgers stay valid. `| undefined` as for accountId.
  participants?: number | undefined;
  categoryId: string;
  // `| undefined`: materialized occurrences copy an absent rule account as undefined (apps/web compiles this module with exactOptionalPropertyTypes).
  accountId?: string | undefined;
  tripId?: string;
  date: string;
  note: string;
  receipt?: Receipt;
  recurringId?: string;
  // Contract 2.4.0 (MAZ-151): an entry paid in another currency keeps the amount it was paid in
  // (minor units of `originalCurrency`) and the rate used; `total` and `share` stay home amounts.
  // All four come together or not at all; `rateDate` names the publication unless the rate was
  // edited. Rules: ./currency.ts.
  originalAmount?: number;
  originalCurrency?: string;
  rate?: string;
  rateStatus?: RateStatus;
  rateDate?: string;
};
export type Recurring = Omit<Transaction, "receipt" | "recurringId" | "tripId" | "originalAmount" | "originalCurrency" | "rate" | "rateStatus" | "rateDate"> & {
  frequency: Frequency;
  nextDate: string;
  anchorDay: number;
  active: boolean;
};
export type Ledger = {
  version: 4;
  currency: string;
  accounts: PaymentAccount[];
  trips: Trip[];
  categories: Category[];
  transactions: Transaction[];
  recurring: Recurring[];
  // Contract 2.3.0: recurring suggestions dismissed on any device, as `{kind}|{key}|{frequency}|{share}`
  // (src/domain/suggestions.ts), at most 500, merged as a set union. Optional, so older ledgers stay valid.
  dismissedSuggestions?: string[];
};
export const palette = [
  "#E47850",
  "#C6953A",
  "#6C9C79",
  "#678DB1",
  "#9D83BA",
  "#C8798D",
];
export const initialCategories: Category[] = [
  {
    id: "groceries",
    name: "Groceries",
    icon: "basket-outline",
    color: "#6C9C79",
    kind: "expense",
  },
  {
    id: "food",
    name: "Food & drinks",
    icon: "cafe-outline",
    color: "#E47850",
    kind: "expense",
  },
  {
    id: "home",
    name: "Home",
    icon: "home-outline",
    color: "#C6953A",
    kind: "expense",
  },
  {
    id: "transport",
    name: "Transport",
    icon: "bus-outline",
    color: "#678DB1",
    kind: "expense",
  },
  {
    id: "shopping",
    name: "Shopping",
    icon: "bag-handle-outline",
    color: "#C8798D",
    kind: "expense",
  },
  {
    id: "fun",
    name: "Entertainment",
    icon: "musical-notes-outline",
    color: "#9D83BA",
    kind: "expense",
  },
  {
    id: "health",
    name: "Health",
    icon: "heart-outline",
    color: "#6C9C79",
    kind: "expense",
  },
  {
    id: "other",
    name: "Other",
    icon: "ellipsis-horizontal",
    color: "#89918C",
    kind: "expense",
  },
  {
    id: "salary",
    name: "Salary",
    icon: "briefcase-outline",
    color: "#6C9C79",
    kind: "income",
  },
  {
    id: "freelance",
    name: "Freelance",
    icon: "laptop-outline",
    color: "#678DB1",
    kind: "income",
  },
  {
    id: "gift",
    name: "Gifts",
    icon: "gift-outline",
    color: "#C6953A",
    kind: "income",
  },
  {
    id: "investments",
    name: "Investments",
    icon: "trending-up-outline",
    color: "#678DB1",
    kind: "investment",
  },
];
export const emptyLedger = (): Ledger => ({
  version: 4,
  currency: "CAD",
  accounts: [],
  trips: [],
  categories: initialCategories.map((c) => ({ ...c })),
  transactions: [],
  recurring: [],
});
export const uid = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
export function dateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export const parseDate = (value: string) => new Date(`${value}T12:00:00`);
export function validDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(parseDate(value).getTime()) &&
    dateKey(parseDate(value)) === value &&
    value >= "2000-01-01" &&
    value <= "2100-12-31"
  );
}
// All monetary calculations use integer cents; never accumulate floating-point dollars.
export function cents(value: string): number {
  value = value.trim();
  if (!/^\d{1,9}([.,]\d{0,2})?$/.test(value))
    throw new Error("Enter an amount with up to two decimal places.");
  const [whole, fraction = ""] = value.split(/[.,]/);
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
export function personalShare(
  total: number,
  mode: "full" | "equal" | "amount" | "percent",
  input: string,
): number {
  if (mode === "full") return total;
  let result: number;
  if (mode === "equal") {
    const people = Number(input);
    if (!Number.isInteger(people) || people < 2 || people > 100)
      throw new Error("Split between 2 and 100 people.");
    result = Math.round(total / people);
  } else if (mode === "percent") {
    const percent = cents(input);
    if (percent > 10000)
      throw new Error("Your percentage must be between 0 and 100.");
    result = Math.round((total * percent) / 10000);
  } else result = cents(input);
  if (result > total)
    throw new Error("Your share cannot exceed the receipt total.");
  return result;
}
/** The participant count a split records: the people of an equal split (checked by personalShare), else none. */
export function splitParticipants(
  mode: "full" | "equal" | "amount" | "percent",
  input: string,
): number | undefined {
  return mode === "equal" ? Number(input) : undefined;
}
/**
 * How the split form reopens a recorded entry or rule: equally between its participants while they
 * still produce its share, else by amount when the share differs from the total, else in full.
 */
export function recordedSplit(entry: Pick<Transaction, "kind" | "total" | "share" | "participants">): "full" | "equal" | "amount" {
  if (entry.kind !== "expense") return "full";
  if (entry.participants !== undefined && Math.round(entry.total / entry.participants) === entry.share) return "equal";
  return entry.share !== entry.total ? "amount" : "full";
}
export function nextOccurrence(
  date: string,
  frequency: Frequency,
  anchorDay: number,
): string {
  const d = parseDate(date);
  if (frequency === "weekly") d.setDate(d.getDate() + 7);
  else {
    const month = d.getMonth() + (frequency === "yearly" ? 12 : 1);
    const last = new Date(d.getFullYear(), month + 1, 0).getDate();
    d.setDate(1);
    d.setMonth(month);
    d.setDate(Math.min(anchorDay, last));
  }
  return dateKey(d);
}
// Advancing nextDate, even when an occurrence exists, makes catch-up idempotent.
export function materialize(ledger: Ledger, today = dateKey()): Ledger {
  const transactions = [...ledger.transactions];
  const existing = new Set(transactions.map((t) => t.id));
  const recurring = ledger.recurring.map((rule) => {
    if (!rule.active) return rule;
    let nextDate = rule.nextDate;
    while (nextDate <= today) {
      const id = `${rule.id}:${nextDate}`;
      if (!existing.has(id)) {
        transactions.push({
          id,
          title: rule.title,
          kind: rule.kind,
          total: rule.total,
          share: rule.share,
          ...(rule.participants !== undefined ? { participants: rule.participants } : {}),
          categoryId: rule.categoryId,
          accountId: rule.accountId,
          date: nextDate,
          note: rule.note,
          recurringId: rule.id,
        });
        existing.add(id);
      }
      nextDate = nextOccurrence(nextDate, rule.frequency, rule.anchorDay);
    }
    return { ...rule, nextDate };
  });
  return { ...ledger, transactions, recurring };
}
export function totals(entries: Transaction[]) {
  return entries.reduce(
    (sum, t) => {
      sum[t.kind] += t.share;
      return sum;
    },
    { income: 0, expense: 0, investment: 0 },
  );
}
export function demoLedger(today = new Date()): Ledger {
  const data = emptyLedger();
  const month = dateKey(today).slice(0, 7);
  const day = Math.max(1, today.getDate());
  const make = (
    title: string,
    total: number,
    categoryId: string,
    offset: number,
    share = total,
    kind: Kind = "expense",
  ): Transaction => ({
    id: uid(),
    title,
    total,
    share,
    categoryId,
    kind,
    date: `${month}-${String(Math.max(1, day - offset)).padStart(2, "0")}`,
    note: "",
    // Half of the total: split equally between two people (MAZ-272).
    ...(kind === "expense" && share * 2 === total ? { participants: 2 } : {}),
  });
  data.transactions = [
    make("Monthly salary", 480000, "salary", 20, 480000, "income"),
    make("Rent", 145000, "home", 20),
    make("Weekly groceries", 8642, "groceries", 0),
    make("Coffee with a friend", 1240, "food", 0, 620),
    make("Dinner at Bar Isabel", 14880, "food", 1, 7440),
    make("Monthly transit pass", 15600, "transport", 5),
    make("A new read", 2499, "shopping", 2),
    make("Weekend groceries", 7235, "groceries", 6),
    make("Design project", 65000, "freelance", 8, 65000, "income"),
    make("Spotify", 1299, "fun", 3),
  ];
  const salary = make("Monthly salary", 480000, "salary", 20, 480000, "income");
  const rent = make("Rent", 145000, "home", 20);
  data.recurring = [salary, rent].map((t) => ({
    ...t,
    id: uid(),
    date: `${month}-01`,
    nextDate: dateKey(new Date(today.getFullYear(), today.getMonth() + 1, 1)),
    frequency: "monthly",
    anchorDay: 1,
    active: true,
  }));
  return data;
}
