import * as SecureStore from "expo-secure-store";
export const getToken = () => SecureStore.getItemAsync("penny-session");
export const setToken = (token: string) =>
  SecureStore.setItemAsync("penny-session", token);
export const clearToken = () => SecureStore.deleteItemAsync("penny-session");
