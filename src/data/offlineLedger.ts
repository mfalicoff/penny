import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Ledger } from "../domain/ledger";
import { serverStorageKey } from "./serverConnection";

const activeAccountKey = "penny:active-account";
const ledgerKey = (email: string) => `penny:ledger:${email.toLowerCase()}`;

export type LocalLedger = { base: Ledger; local: Ledger };

export async function readActiveAccount(): Promise<string | null> {
  return AsyncStorage.getItem(await serverStorageKey(activeAccountKey));
}

export async function rememberAccount(email: string): Promise<void> {
  await AsyncStorage.setItem(await serverStorageKey(activeAccountKey), email);
}

export async function forgetAccount(): Promise<void> {
  await AsyncStorage.removeItem(await serverStorageKey(activeAccountKey));
}

export async function readLocalLedger(email: string): Promise<LocalLedger | null> {
  const stored = await AsyncStorage.getItem(await serverStorageKey(ledgerKey(email)));
  if (!stored) return null;
  const value = JSON.parse(stored) as LocalLedger;
  if (!value?.base || !value?.local || value.base.version !== 4 || value.local.version !== 4)
    throw new Error("The saved ledger could not be read. Reinstalling would erase unsynced changes.");
  return value;
}

export async function writeLocalLedger(email: string, value: LocalLedger): Promise<void> {
  await AsyncStorage.setItem(await serverStorageKey(ledgerKey(email)), JSON.stringify(value));
}

export async function removeLocalLedger(email: string): Promise<void> {
  await AsyncStorage.removeItem(await serverStorageKey(ledgerKey(email)));
}

export function hasPendingChanges(value: LocalLedger): boolean {
  return JSON.stringify(value.base) !== JSON.stringify(value.local);
}

type Item = { id: string };

function mergeItems<T extends Item>(base: T[], local: T[], remote: T[]): T[] {
  const before = new Map(base.map((item) => [item.id, item]));
  const changed = new Map(local.filter((item) => JSON.stringify(item) !== JSON.stringify(before.get(item.id)))
    .map((item) => [item.id, item]));
  const removed = new Set(base.filter((item) => !local.some((next) => next.id === item.id)).map((item) => item.id));
  const remoteIds = new Set(remote.map((item) => item.id));
  const result = remote.filter((item) => !removed.has(item.id)).map((item) => {
    const next = changed.get(item.id);
    if (!next) return item;
    const original = before.get(item.id);
    if (!original) return next;
    // Keep remote fields this device did not edit.
    const merged = { ...item } as Record<string, unknown>;
    for (const key of new Set([...Object.keys(original), ...Object.keys(next)])) {
      if (JSON.stringify(next[key as keyof T]) !== JSON.stringify(original[key as keyof T]))
        merged[key] = next[key as keyof T];
    }
    return merged as T;
  });
  for (const item of local) if (!remoteIds.has(item.id) && changed.has(item.id)) result.push(item);
  return result;
}

export function mergeLedger(base: Ledger, local: Ledger, remote: Ledger): Ledger {
  return {
    ...remote,
    currency: local.currency !== base.currency ? local.currency : remote.currency,
    accounts: mergeItems(base.accounts, local.accounts, remote.accounts),
    trips: mergeItems(base.trips, local.trips, remote.trips),
    categories: mergeItems(base.categories, local.categories, remote.categories),
    transactions: mergeItems(base.transactions, local.transactions, remote.transactions),
    recurring: mergeItems(base.recurring, local.recurring, remote.recurring),
  };
}
