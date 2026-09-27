import { accountTypes, dateKey, nextOccurrence, type Category, type Ledger, type PaymentAccount, type Recurring, type Transaction } from "./ledger.ts";

export type LedgerChange = (ledger: Ledger) => Ledger;

export function saveEntry(transaction: Transaction, original?: Transaction, recurring?: Recurring): LedgerChange {
  return (ledger) => {
    assertAccount(ledger, transaction.accountId);
    if (recurring) assertAccount(ledger, recurring.accountId);
    if (!ledger.categories.some((c) => c.id === transaction.categoryId && c.kind === transaction.kind))
      throw new Error("This category was removed on another device. Choose another category.");
    if (original && JSON.stringify(ledger.transactions.find((t) => t.id === original.id)) !== JSON.stringify(original))
      throw new Error("This entry changed on another device. Close this form and reopen the entry to review the latest version.");
    return {
      ...ledger,
      transactions: [...ledger.transactions.filter((t) => t.id !== transaction.id), transaction],
      recurring: recurring ? [...ledger.recurring, recurring] : ledger.recurring,
    };
  };
}

export function deleteEntry(original: Transaction): LedgerChange {
  return (ledger) => {
    if (JSON.stringify(ledger.transactions.find((t) => t.id === original.id)) !== JSON.stringify(original))
      throw new Error("This entry changed on another device. Reopen it before deleting.");
    return { ...ledger, transactions: ledger.transactions.filter((t) => t.id !== original.id) };
  };
}

export function saveCategory(item: Category, original?: Category, remove = false): LedgerChange {
  return (ledger) => {
    if (original && JSON.stringify(ledger.categories.find((c) => c.id === original.id)) !== JSON.stringify(original))
      throw new Error("This category changed on another device. Reopen it before editing.");
    if (remove && [...ledger.transactions, ...ledger.recurring].some((t) => t.categoryId === item.id))
      throw new Error("This category has entries. Keep it to preserve your history.");
    if (!remove && ledger.categories.some((c) => c.id !== item.id && c.kind === item.kind && c.name.toLowerCase() === item.name.toLowerCase()))
      throw new Error("You already have a category with this name.");
    return {
      ...ledger,
      categories: remove ? ledger.categories.filter((c) => c.id !== item.id)
        : original ? ledger.categories.map((c) => c.id === item.id ? item : c)
          : [...ledger.categories, item],
    };
  };
}

export function setScheduleActive(id: string, active: boolean, today = dateKey()): LedgerChange {
  return (ledger) => ({
    ...ledger,
    recurring: ledger.recurring.map((rule) => {
      if (rule.id !== id) return rule;
      let nextDate = rule.nextDate;
      if (active && !rule.active)
        while (nextDate <= today) nextDate = nextOccurrence(nextDate, rule.frequency, rule.anchorDay);
      return { ...rule, active, nextDate };
    }),
  });
}

export function removeSchedule(id: string): LedgerChange {
  return (ledger) => ({ ...ledger, recurring: ledger.recurring.filter((rule) => rule.id !== id) });
}

export function saveSchedule(rule: Recurring, original: Recurring): LedgerChange {
  return (ledger) => {
    assertAccount(ledger, rule.accountId);
    if (JSON.stringify(ledger.recurring.find((r) => r.id === original.id)) !== JSON.stringify(original))
      throw new Error("This schedule changed on another device. Close this form and reopen it to review the latest version.");
    if (!ledger.categories.some((c) => c.id === rule.categoryId && c.kind === rule.kind))
      throw new Error("This category was removed on another device. Choose another category.");
    return { ...ledger, recurring: ledger.recurring.map((r) => r.id === original.id ? rule : r) };
  };
}

function assertAccount(ledger: Ledger, accountId?: string) {
  if (accountId !== undefined && !ledger.accounts.some((a) => a.id === accountId))
    throw new Error("This payment account was removed on another device. Choose another account.");
}

export function saveAccount(item: PaymentAccount, original?: PaymentAccount, remove = false): LedgerChange {
  return (ledger) => {
    if (original && JSON.stringify(ledger.accounts.find((a) => a.id === original.id)) !== JSON.stringify(original))
      throw new Error("This account changed on another device. Reopen it before editing.");
    if (remove && [...ledger.transactions, ...ledger.recurring].some((t) => t.accountId === item.id))
      throw new Error("This account has entries or schedules. Reassign them before deleting it.");
    const name = item.name.trim();
    if (!remove) {
      if (!name || name.length > 50) throw new Error("Give your account a name of up to 50 characters.");
      if (!accountTypes.includes(item.type)) throw new Error("Choose an account type.");
      if (ledger.accounts.some((a) => a.id !== item.id && a.name.toLowerCase() === name.toLowerCase()))
        throw new Error("You already have an account with this name.");
      if (!original && ledger.accounts.length >= 300) throw new Error("You can add up to 300 accounts.");
    }
    const account = { ...item, name };
    return { ...ledger, accounts: remove ? ledger.accounts.filter((a) => a.id !== item.id)
      : original ? ledger.accounts.map((a) => a.id === item.id ? account : a) : [...ledger.accounts, account] };
  };
}

export function changeCurrency(currency: string): LedgerChange {
  return (ledger) => {
    if (ledger.transactions.length || ledger.recurring.length)
      throw new Error("Currency can only be changed before adding entries.");
    return { ...ledger, currency };
  };
}
