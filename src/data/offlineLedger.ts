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

// The three-way merge is pure domain logic shared with the contract fixtures (MAZ-62).
export { mergeLedger } from "../domain/merge";
