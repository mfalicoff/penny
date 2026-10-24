import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

const storageKey = "penny-app-lock";
type AppLock = {
  loading: boolean;
  enabled: boolean;
  locked: boolean;
  admitted: boolean;
  obscured: boolean;
  busy: boolean;
  error: string;
  retry: () => Promise<void>;
  unlock: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
};
const Context = createContext<AppLock | null>(null);
export const useAppLock = () => useContext(Context);

function authenticationError(error: LocalAuthentication.LocalAuthenticationError): string {
  if (error === "not_enrolled") return "Set up Face ID or fingerprints in your device settings, then try again.";
  if (error === "not_available") return "Biometric authentication is unavailable. Check your device settings and try again.";
  if (error === "lockout") return "Biometrics are locked. Unlock your device with its passcode, then try again.";
  if (error === "user_cancel" || error === "system_cancel" || error === "app_cancel") return "Authentication canceled. Your protection setting is unchanged.";
  return "Authentication failed. Please try again.";
}

export function AppLockProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [enabled, setSavedEnabled] = useState(false);
  const [locked, setLocked] = useState(true);
  const [admitted, setAdmitted] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const enabledRef = useRef(false);
  const busyRef = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  const invalidateAuthentication = useCallback(() => { generation.current++; }, []);

  const authenticate = useCallback(async (enabling = false): Promise<boolean> => {
    if (busyRef.current || AppState.currentState !== "active") return false;
    busyRef.current = true;
    setBusy(true);
    setError("");
    const attempt = generation.current;
    try {
      if (enabling && (!await LocalAuthentication.hasHardwareAsync()
        || await LocalAuthentication.getEnrolledLevelAsync() < LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG)) {
        setError("Set up Face ID or strong fingerprint/face authentication in your device settings first.");
        return false;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: enabling ? "Enable biometric protection for Penny" : "Unlock Penny",
        cancelLabel: "Cancel",
        biometricsSecurityLevel: "strong",
        disableDeviceFallback: enabling,
        ...(enabling ? { fallbackLabel: "" } : {}),
      });
      // A result from before backgrounding must never unlock a later foreground session.
      if (!mounted.current || attempt !== generation.current) return false;
      if (!result.success) { setError(authenticationError(result.error)); return false; }
      return true;
    } catch {
      if (mounted.current) setError("Could not authenticate. Check your device security settings and try again.");
      return false;
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);

  const unlock = useCallback(async () => {
    if (await authenticate()) { setAdmitted(true); setLocked(false); }
  }, [authenticate]);

  const readSetting = useCallback(() => SecureStore.getItemAsync(storageKey).then((stored) => {
    if (stored !== null && stored !== "true" && stored !== "false") throw new Error("Invalid lock setting");
    if (!mounted.current) return;
    const next = stored === "true";
    enabledRef.current = next;
    setSavedEnabled(next);
    setLocked(next);
    if (!next) setAdmitted(true);
    setError("");
    setLoading(false);
    if (next) void unlock();
  }).catch(() => {
    if (mounted.current) setError("Could not read your app protection setting. Retry to safely open Penny.");
  }), [unlock]);

  useEffect(() => {
    mounted.current = true;
    void readSetting();
    let backgrounded = AppState.currentState === "background";
    const subscription = AppState.addEventListener("change", (state) => {
      setForeground(state === "active");
      if (state === "background") {
        invalidateAuthentication();
        if (enabledRef.current) setLocked(true);
      }
      if (state === "active") {
        // The biometric prompt can temporarily make iOS inactive without backgrounding.
        const needsUnlock = backgrounded && enabledRef.current;
        backgrounded = false;
        if (needsUnlock) void unlock();
      }
      if (state === "background") backgrounded = true;
    });
    return () => { mounted.current = false; invalidateAuthentication(); subscription.remove(); };
  }, [readSetting, unlock, invalidateAuthentication]);

  const setEnabled = useCallback(async (next: boolean) => {
    if (busyRef.current || next === enabledRef.current) return;
    const attempt = generation.current;
    if (!await authenticate(next)) return;
    // Keep the operation single-flight until the preference is durably saved.
    busyRef.current = true;
    setBusy(true);
    try {
      await SecureStore.setItemAsync(storageKey, String(next));
      enabledRef.current = next;
      setSavedEnabled(next);
      setLocked(next && (attempt !== generation.current || AppState.currentState === "background"));
    } catch {
      setError("Could not save app protection. Your previous setting is unchanged.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [authenticate]);

  return <Context.Provider value={{ loading, enabled, locked, admitted, obscured: loading || locked || (enabled && !foreground), busy, error, retry: readSetting, unlock, setEnabled }}>
    {children}
  </Context.Provider>;
}
