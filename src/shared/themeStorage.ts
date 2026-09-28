import * as SecureStore from "expo-secure-store";

const key = "penny-theme";
export const getSavedTheme = () => SecureStore.getItemAsync(key);
export const saveTheme = (theme: string) => SecureStore.setItemAsync(key, theme);
