import { cents, nextOccurrence, parseDate, personalShare, uid, validDate, type Category, type Frequency, type Kind, type Receipt, type Recurring, type Transaction } from "../../domain/ledger.ts";

export type EntryDraft = {
  kind: Kind;
  title: string;
  amount: string;
  date: string;
  categoryId: string;
  accountId?: string;
  note: string;
  split: "full" | "equal" | "amount" | "percent";
  shareInput: string;
  frequency: Frequency | "none";
  receipt?: Receipt;
};

// Validate and build before any upload or network save. The form owns only input state.
export function buildEntry(draft: EntryDraft, categories: Category[], entry?: Transaction) {
  const { kind, title, amount, date, categoryId, note, split, shareInput, frequency, receipt } = draft;
  const total = cents(amount);
  if (!total) throw new Error("Enter an amount greater than zero.");
  if (!validDate(date)) throw new Error("Use a valid date between 2000 and 2100, in YYYY-MM-DD format.");
  if (!title.trim()) throw new Error("Add a name for this entry.");
  if (!categories.some((c) => c.id === categoryId && c.kind === kind)) throw new Error("Choose a category.");
  const transaction: Transaction = {
    id: entry?.id ?? uid(), kind, title: title.trim(), total,
    share: personalShare(total, kind === "expense" ? split : "full", shareInput),
    date, categoryId, accountId: draft.accountId, note: note.trim(), receipt: kind === "expense" ? receipt : undefined,
    recurringId: entry?.recurringId,
  };
  let recurring: Recurring | undefined;
  if (!entry && frequency !== "none") {
    const { receipt: _, recurringId: __, ...base } = transaction;
    const anchorDay = parseDate(date).getDate();
    recurring = { ...base, id: uid(), active: true, frequency, nextDate: nextOccurrence(date, frequency, anchorDay), anchorDay };
    transaction.recurringId = recurring.id;
  }
  return { transaction, recurring };
}

export function buildSchedule(draft: EntryDraft, categories: Category[], original: Recurring): Recurring {
  if (draft.frequency === "none") throw new Error("Choose a repeat schedule.");
  const { transaction } = buildEntry(draft, categories, original);
  const { receipt: _, recurringId: __, ...details } = transaction;
  return {
    ...original, ...details, date: original.date,
    frequency: draft.frequency, nextDate: draft.date,
    anchorDay: draft.date === original.nextDate ? original.anchorDay : parseDate(draft.date).getDate(),
  };
}
