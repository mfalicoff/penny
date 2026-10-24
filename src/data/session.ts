import * as SecureStore from "expo-secure-store";
import { serverStorageKey, type ServerConfiguration } from "./serverConnection";

export const getToken = async (server?: ServerConfiguration) =>
  SecureStore.getItemAsync(await serverStorageKey("penny-session", server));
export const setToken = async (token: string) =>
  SecureStore.setItemAsync(await serverStorageKey("penny-session"), token);
export const clearToken = async () => SecureStore.deleteItemAsync(await serverStorageKey("penny-session"));
