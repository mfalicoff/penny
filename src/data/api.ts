import { Platform } from "react-native";
import { materialize, type Ledger } from "../domain/ledger";
import { clearToken, getToken, setToken } from "./session";
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === "web" ? "" : "http://localhost:3001");
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api(path: string, options: RequestInit = {}) {
  const token = await getToken();
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api${path}`, {
      ...options,
      credentials: "include",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
      signal: options.signal ?? AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError(
      "Cannot reach your server. Check your connection and try again.",
      0,
    );
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(
      body.error || "The server could not complete this request.",
      response.status,
    );
  }
  return response;
}
export async function signIn(
  email: string,
  password: string,
  register: boolean,
) {
  const data = await (
    await api(`/auth/${register ? "register" : "login"}`, {
      method: "POST",
      body: JSON.stringify({ email, password }),
    })
  ).json();
  await setToken(data.token);
  return data.email as string;
}
export async function signOut() {
  try {
    await api("/auth/logout", { method: "POST" });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
  }
  await clearToken();
}
export async function whoAmI() {
  return (await (await api("/auth/me")).json()).email as string;
}
export type Snapshot = { revision: number; ledger: Ledger; };
export async function fetchLedger(): Promise<Snapshot> {
  return (await api("/ledger")).json();
}
export async function saveSnapshot(snapshot: Snapshot): Promise<Snapshot> {
  return (
    await api("/ledger", { method: "PUT", body: JSON.stringify(snapshot) })
  ).json();
}
// Merge a specific operation into the freshest state and retry revision races.
export async function mutateLedger(
  change: (ledger: Ledger) => Ledger,
): Promise<Snapshot> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const latest = await fetchLedger();
    const ledger = materialize(change(materialize(latest.ledger)));
    try {
      return await saveSnapshot({ revision: latest.revision, ledger });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409 || attempt === 3)
        throw error;
    }
  }
  throw new Error("Sync failed. Please try again.");
}
