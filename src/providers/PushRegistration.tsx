import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { router, type Href } from "expo-router";
import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { api } from "../data/api";
import { householdPushPath } from "../data/push";
import { useLedger } from "./LedgerProvider";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let registeredToken: string | null = null;
let registeredEmail: string | null = null;
let registration: Promise<void> | null = null;

async function registerCurrentDevice(email: string): Promise<void> {
  if (registration) await registration;
  if (registeredToken && registeredEmail === email) return;
  const pending = (async () => {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("households", {
        name: "Household activity",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    let permission = await Notifications.getPermissionsAsync();
    if (permission.status !== "granted" && permission.canAskAgain) {
      permission = await Notifications.requestPermissionsAsync();
    }
    if (permission.status !== "granted") return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (typeof projectId !== "string" || !projectId) return;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await api("/push/devices", {
      method: "POST",
      body: JSON.stringify({ token, platform: Platform.OS }),
    });
    registeredToken = token;
    registeredEmail = email;
  })();
  registration = pending;
  try { await pending; }
  finally { if (registration === pending) registration = null; }
}

/** Call before signOut clears/revokes the session, so the DELETE request stays authenticated. */
export async function unregisterPushForLogout(): Promise<void> {
  try { await registration; } catch { /* Registration can fail offline. */ }
  const token = registeredToken;
  registeredToken = null;
  registeredEmail = null;
  if (!token) return;
  try {
    await api("/push/devices", { method: "DELETE", body: JSON.stringify({ token }) });
  } catch {
    // Logout must still proceed if a device is offline. Server logout also revokes user devices.
  }
}

/** Mount once under LedgerProvider. Web uses PushRegistration.web.tsx instead. */
export function PushRegistration() {
  const { email, demo } = useLedger();

  useEffect(() => {
    if (!email || demo) return;
    void registerCurrentDevice(email).catch(() => {
      // Push is optional; failed registration must not block the ledger.
    });
    const open = (response: Notifications.NotificationResponse) => {
      if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const path = householdPushPath(response.notification.request.content.data);
      if (!path) return;
      Notifications.clearLastNotificationResponse();
      router.push(path as Href);
    };
    const last = Notifications.getLastNotificationResponse();
    if (last) open(last);
    const responseListener = Notifications.addNotificationResponseReceivedListener(open);
    const tokenListener = Notifications.addPushTokenListener(() => {
      registeredToken = null;
      void registerCurrentDevice(email).catch(() => {});
    });
    const foregroundListener = AppState.addEventListener("change", (state) => {
      if (state === "active") void registerCurrentDevice(email).catch(() => {});
    });
    return () => { responseListener.remove(); tokenListener.remove(); foregroundListener.remove(); };
  }, [email, demo]);

  return null;
}
