import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const configurationKey = "penny:server-connection";
export const defaultServerUrl = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3001";
export type ServerConfiguration = { url: string; legacyUrl: string; version?: string };
export type PennyServer = { url: string; version: string };

export function normalizeServerUrl(input: string): string {
  let url: URL;
  try { url = new URL(input.trim()); }
  catch { throw new Error("Enter a full server URL, such as https://penny.example.com."); }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error("Use an HTTP or HTTPS URL without credentials, a query, or a fragment.");
  }
  return url.toString().replace(/\/+$/, "");
}

// Persist the former build-time address once. Do not validate during migration:
// existing sessions and offline entries must survive even when the server is down.
export async function readServerConfiguration(): Promise<ServerConfiguration> {
  // Web has no device setting. Deployed web uses its own origin; retain the
  // existing build-time override for Expo's separate development server.
  if (Platform.OS === "web") return { url: process.env.EXPO_PUBLIC_API_URL || "", legacyUrl: "" };
  const stored = await AsyncStorage.getItem(configurationKey);
  if (stored) {
    const value = JSON.parse(stored) as ServerConfiguration;
    if (typeof value.url !== "string" || typeof value.legacyUrl !== "string")
      throw new Error("The saved server setting could not be read.");
    return value;
  }
  const url = normalizeServerUrl(defaultServerUrl);
  const initial = { url, legacyUrl: url };
  await AsyncStorage.setItem(configurationKey, JSON.stringify(initial));
  return initial;
}

export async function getServerUrl(): Promise<string> {
  return (await readServerConfiguration()).url;
}

/** The original server keeps the existing keys; all others get an isolated namespace. */
export async function serverStorageKey(key: string, configuration?: ServerConfiguration): Promise<string> {
  if (Platform.OS === "web") return key;
  const { url, legacyUrl } = configuration ?? await readServerConfiguration();
  if (url === legacyUrl) return key;
  // Hex is also safe in SecureStore keys (unlike URL punctuation).
  const scope = Array.from(url, (character) => character.codePointAt(0)!.toString(16)).join(".");
  return `${key}.${scope}`;
}

/** Never use api() here: a candidate server must not receive the current session. */
export async function probePennyServer(input: string): Promise<PennyServer> {
  const url = normalizeServerUrl(input);
  let response: Response;
  try {
    response = await fetch(`${url}/api/info`, {
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new Error("Cannot reach this server. Check the URL, connection, and HTTPS configuration.");
  }
  const info = await response.json().catch(() => null);
  if (!response.ok || info?.name !== "penny" || typeof info.version !== "string" || !info.version.trim() || info.version.length > 100) {
    throw new Error("This address did not identify itself as a Penny server. Check the URL and update older Penny servers.");
  }
  return { url, version: info.version };
}

export async function saveServerConfiguration(server: PennyServer): Promise<ServerConfiguration> {
  if (Platform.OS === "web") throw new Error("Web uses the server hosting this app.");
  const current = await readServerConfiguration();
  const next = { ...current, url: normalizeServerUrl(server.url), version: server.version };
  await AsyncStorage.setItem(configurationKey, JSON.stringify(next));
  return next;
}
