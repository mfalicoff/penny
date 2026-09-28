import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from "react";
import { Appearance, Platform } from "react-native";
import { getSavedTheme, saveTheme } from "./themeStorage";

export type ThemeName = "light" | "dark" | "amoled" | "catppuccin";

export const themeOptions: { id: ThemeName; label: string; description: string }[] = [
  { id: "light", label: "Light", description: "Warm and airy" },
  { id: "dark", label: "Dark", description: "Easy on the eyes" },
  { id: "amoled", label: "AMOLED", description: "True black" },
  { id: "catppuccin", label: "Catppuccin", description: "Mocha palette" },
];

export const palettes = {
  light: {
    bg: "#F8F8F4", paper: "#FFFFFF", ink: "#283B33", muted: "#839087",
    line: "#E9EDE7", accent: "#D96B42", onAccent: "#FFFFFF",
    orangeBg: "#FBEEE6", green: "#528768", blue: "#678DB1", pale: "#EDF3EC",
    input: "#FBFCF9", chrome: "#FEFFFC", soft: "#F5F7F0", avatar: "#EAF0E5",
    subtle: "#8A988A", placeholder: "#A5ACA6", danger: "#B45343",
    dangerBg: "#FFF1ED", backdrop: "#21332960", shadow: "#1C302B20",
    expenseFeedback: "#B94E43", expenseFeedbackBg: "#FBE9E6",
    incomeFeedback: "#347B53", incomeFeedbackBg: "#E8F4EA",
    investmentFeedbackBg: "#EAF1F8", successFeedback: "#B4D7B6",
  },
  dark: {
    bg: "#171D1B", paper: "#232B27", ink: "#F1F5EE", muted: "#A7B7AD",
    line: "#3A4740", accent: "#ED9A74", onAccent: "#241811",
    orangeBg: "#493126", green: "#91C9A3", blue: "#94B8D9", pale: "#303E35",
    input: "#29332D", chrome: "#1C2420", soft: "#2B3730", avatar: "#36483B",
    subtle: "#9AAA9F", placeholder: "#92A398", danger: "#F0A295",
    dangerBg: "#4B2C2B", backdrop: "#000000A6", shadow: "#00000055",
    expenseFeedback: "#F0A295", expenseFeedbackBg: "#4B2C2B",
    incomeFeedback: "#91C9A3", incomeFeedbackBg: "#294235",
    investmentFeedbackBg: "#2B3B4C", successFeedback: "#91C9A3",
  },
  amoled: {
    bg: "#000000", paper: "#0B0B0B", ink: "#F8F8F8", muted: "#B5B5B5",
    line: "#2A2A2A", accent: "#FF946D", onAccent: "#24140C",
    orangeBg: "#332017", green: "#89D6A4", blue: "#91BFF0", pale: "#171D19",
    input: "#111411", chrome: "#000000", soft: "#111711", avatar: "#202820",
    subtle: "#AAAAAA", placeholder: "#929292", danger: "#FFA597",
    dangerBg: "#351A1A", backdrop: "#000000C4", shadow: "#00000088",
    expenseFeedback: "#FFA597", expenseFeedbackBg: "#351A1A",
    incomeFeedback: "#89D6A4", incomeFeedbackBg: "#152C1D",
    investmentFeedbackBg: "#142536", successFeedback: "#89D6A4",
  },
  catppuccin: {
    bg: "#1E1E2E", paper: "#252536", ink: "#CDD6F4", muted: "#A6ADC8",
    line: "#45475A", accent: "#CBA6F7", onAccent: "#1E1E2E",
    orangeBg: "#3B304D", green: "#A6E3A1", blue: "#89B4FA", pale: "#313244",
    input: "#313244", chrome: "#181825", soft: "#2A2A3D", avatar: "#45475A",
    subtle: "#A6ADC8", placeholder: "#9399B2", danger: "#F38BA8",
    dangerBg: "#44303F", backdrop: "#11111BCC", shadow: "#11111B77",
    expenseFeedback: "#F38BA8", expenseFeedbackBg: "#44303F",
    incomeFeedback: "#A6E3A1", incomeFeedbackBg: "#2C403A",
    investmentFeedbackBg: "#2D3A54", successFeedback: "#A6E3A1",
  },
} as const;

export type ThemeColors = { -readonly [K in keyof typeof palettes.light]: string };
export const C: ThemeColors = { ...palettes.light };
let activeTheme: ThemeName = "light";
let contextSetter: ((next: ThemeName) => void) | undefined;
const ThemeContext = createContext<ThemeName>("light");
export const useTheme = () => useContext(ThemeContext);
export const getTheme = () => activeTheme;

function syncPlatformAppearance(theme: ThemeName) {
  const mode = theme === "light" ? "light" : "dark";
  if (Platform.OS !== "web") Appearance.setColorScheme(mode);
  else if (typeof document !== "undefined") document.documentElement.style.colorScheme = mode;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [name, setName] = useState<ThemeName>("light");

  useEffect(() => {
    void getSavedTheme().then((saved) => {
      if (saved && saved in palettes) {
        activeTheme = saved as ThemeName;
        Object.assign(C, palettes[activeTheme]);
        setName(activeTheme);
      }
    }).catch(() => { /* Keep light if device storage is unavailable. */ });
  }, []);
  useEffect(() => { syncPlatformAppearance(name); }, [name]);

  useEffect(() => {
    contextSetter = setName;
    return () => { contextSetter = undefined; };
  }, []);
  return createElement(ThemeContext.Provider, { value: name }, children);
}

export function setTheme(next: ThemeName) {
  activeTheme = next;
  Object.assign(C, palettes[next]);
  syncPlatformAppearance(next);
  contextSetter?.(next);
  void saveTheme(next).catch(() => {});
}

export async function loadTheme() {
  try {
    const saved = await getSavedTheme();
    if (saved && saved in palettes) setTheme(saved as ThemeName);
  } catch { /* Keep the default theme if device storage is unavailable. */ }
}
