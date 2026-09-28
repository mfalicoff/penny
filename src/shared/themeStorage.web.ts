const key = "penny-theme";
export const getSavedTheme = async () => typeof localStorage === "undefined" ? null : localStorage.getItem(key);
export const saveTheme = async (theme: string) => { if (typeof localStorage !== "undefined") localStorage.setItem(key, theme); };
