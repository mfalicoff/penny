import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { ApiError, fetchLedger, saveSnapshot, signOut, whoAmI } from "../data/api";
import { forgetAccount, hasPendingChanges, mergeLedger, readActiveAccount, readLocalLedger, rememberAccount, removeLocalLedger, writeLocalLedger, type LocalLedger } from "../data/offlineLedger";
import type { LedgerChange } from "../domain/commands";
import { demoLedger, emptyLedger, materialize, type Kind, type Ledger } from "../domain/ledger";
import { PushRegistration, unregisterPushForLogout } from "./PushRegistration";

function useLedgerSession() {
  const [email, setEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [demo, setDemo] = useState(false);
  const [ledger, setLedger] = useState<Ledger>(emptyLedger);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState("");
  const [toastKind, setToastKind] = useState<Kind | null>(null);
  const [toastSequence, setToastSequence] = useState(0);
  const [sessionKey, setSessionKey] = useState(0);
  const ledgerRef = useRef(ledger);
  const localRef = useRef<LocalLedger | null>(null);
  const operation = useRef(false);
  const online = useRef(true);
  const serverAvailable = useRef(true);
  const probing = useRef(false);
  const generation = useRef(0);

  function showToast(message: string, kind?: Kind) {
    setToast(message);
    setToastKind(kind ?? null);
    setToastSequence((value) => value + 1);
  }

  function replaceLedger(next: Ledger) {
    ledgerRef.current = next;
    setLedger(next);
  }

  // Async results belong to the session that started them, including startup checks.
  useEffect(() => {
    const session = generation;
    const current = session.current;
    (async () => {
      let cachedAddress: string | null = null;
      try {
        cachedAddress = await readActiveAccount();
        if (cachedAddress) {
          const cached = await readLocalLedger(cachedAddress);
          if (current !== generation.current) return;
          if (cached) {
            localRef.current = cached;
            replaceLedger(cached.local);
            setPending(hasPendingChanges(cached));
            setReady(true);
            setEmail(cachedAddress);
            setChecking(false);
          }
        }
      } catch (error) {
        if (current === generation.current) setSyncError(error instanceof Error ? error.message : "Could not read saved entries.");
      }
      try {
        const address = await whoAmI();
        if (current !== generation.current) return;
        if (address !== cachedAddress) {
          const cached = await readLocalLedger(address);
          if (current !== generation.current) return;
          localRef.current = cached;
          replaceLedger(cached?.local ?? emptyLedger());
          setPending(cached ? hasPendingChanges(cached) : false);
          setReady(Boolean(cached));
          setEmail(address);
        }
        await rememberAccount(address);
      } catch (error) {
        if (current !== generation.current) return;
        if (error instanceof ApiError && error.status === 401) {
          localRef.current = null;
          replaceLedger(emptyLedger());
          setPending(false);
          setReady(false);
          setEmail(null);
          void forgetAccount();
        } else if (error instanceof ApiError && error.status !== 0 || !cachedAddress)
          setSyncError(error instanceof Error ? error.message : "Could not load your account.");
      } finally {
        if (current === generation.current) setChecking(false);
      }
    })();
    return () => { session.current++; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast, toastSequence]);

  const sync = useCallback(async () => {
    if (!email || demo || checking || operation.current) return;
    const current = generation.current;
    operation.current = true;
    setSyncing(true);
    try {
      const network = await NetInfo.fetch();
      if (network.isConnected === false || network.isInternetReachable === false) {
        online.current = false;
        setSyncError("Offline. Saved changes will sync when you reconnect.");
        return;
      }
      online.current = true;
      let snapshot = await fetchLedger();
      if (current !== generation.current) return;
      const cached = localRef.current;
      for (let attempt = 0; attempt < 4; attempt++) {
        const merged = materialize(cached && hasPendingChanges(cached)
          ? mergeLedger(cached.base, cached.local, snapshot.ledger) : snapshot.ledger);
        if (JSON.stringify(merged) === JSON.stringify(snapshot.ledger)) break;
        try {
          snapshot = await saveSnapshot({ revision: snapshot.revision, ledger: merged });
          break;
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 409 || attempt === 3) throw error;
          snapshot = await fetchLedger();
        }
      }
      if (current !== generation.current) return;
      await writeLocalLedger(email, { base: snapshot.ledger, local: snapshot.ledger });
      if (current === generation.current) {
        localRef.current = { base: snapshot.ledger, local: snapshot.ledger };
        replaceLedger(snapshot.ledger);
        setPending(false);
        setReady(true);
        setSyncError("");
        serverAvailable.current = true;
      }
    } catch (error) {
      if (current === generation.current) {
        if (error instanceof ApiError && error.status === 0) serverAvailable.current = false;
        setSyncError(error instanceof Error ? error.message : "Sync failed. Please try again.");
      }
    } finally {
      if (current === generation.current) {
        operation.current = false;
        setSyncing(false);
      }
    }
  }, [email, demo, checking]);

  useEffect(() => {
    if (!email || demo || checking) return;
    // Initial fetch updates the loading indicator while synchronizing with the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void sync();
    const retry = () => {
      if (!online.current) return;
      if (serverAvailable.current) { void sync(); return; }
      if (probing.current) return;
      probing.current = true;
      const current = generation.current;
      void fetchLedger().then(() => {
        if (current === generation.current) {
          serverAvailable.current = true;
          void sync();
        }
      }).catch(() => {}).finally(() => { probing.current = false; });
    };
    const timer = setInterval(() => {
      if (AppState.currentState === "active" || Platform.OS === "web") retry();
    }, 15000);
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") retry();
    });
    const unsubscribe = NetInfo.addEventListener((state) => {
      const wasOnline = online.current;
      online.current = state.isConnected !== false && state.isInternetReachable !== false;
      if (online.current && !wasOnline) {
        serverAvailable.current = true;
        void sync();
      }
    });
    return () => { clearInterval(timer); listener.remove(); unsubscribe(); };
  }, [sync, email, demo, checking]);

  async function commit(change: LedgerChange, message: string, feedbackKind?: Kind) {
    if (operation.current) throw new Error("Sync is finishing. Please try again in a moment.");
    if (!email && !demo) throw new Error("Sign in before saving an entry.");
    if (!demo && !ready) throw new Error("Wait for your ledger to load before saving.");
    const current = generation.current;
    operation.current = true;
    setSyncing(true);
    try {
      const next = materialize(change(ledgerRef.current));
      if (!demo && email) {
        const currentLocal = localRef.current;
        if (!currentLocal) throw new Error("Your saved ledger is not ready.");
        const updated = { base: currentLocal.base, local: next };
        await writeLocalLedger(email, updated);
        localRef.current = updated;
        setPending(hasPendingChanges(updated));
      }
      if (current !== generation.current) throw new Error("Your session changed. Reopen this entry before saving.");
      replaceLedger(next);
      setSyncError("");
      showToast(message, feedbackKind);
      if (!demo && online.current && serverAvailable.current) setTimeout(() => { void sync(); }, 0);
    } catch (error) {
      if (current === generation.current) setSyncError(error instanceof Error ? error.message : "Could not save.");
      throw error;
    } finally {
      if (current === generation.current) {
        operation.current = false;
        setSyncing(false);
      }
    }
  }

  function startSession(address: string | null, isDemo: boolean) {
    generation.current++;
    operation.current = false;
    setSessionKey((value) => value + 1);
    setEmail(address);
    setDemo(isDemo);
    setChecking(Boolean(address));
    replaceLedger(isDemo ? demoLedger() : emptyLedger());
    localRef.current = null;
    setReady(isDemo);
    setPending(false);
    setSyncing(false);
    setSyncError("");
    setToast("");
    setToastKind(null);
    if (address) {
      const current = generation.current;
      void (async () => {
        try {
          const cached = await readLocalLedger(address);
          if (current !== generation.current) return;
          localRef.current = cached;
          if (cached) replaceLedger(cached.local);
          setPending(cached ? hasPendingChanges(cached) : false);
          setReady(Boolean(cached));
          await rememberAccount(address);
        } catch (error) {
          if (current === generation.current) setSyncError(error instanceof Error ? error.message : "Could not load saved entries.");
        } finally {
          if (current === generation.current) setChecking(false);
        }
      })();
    }
  }

  async function logout() {
    if (operation.current) return false;
    if (pending) {
      setSyncError("Your changes are still waiting to sync. Connect and retry before signing out.");
      return false;
    }
    operation.current = true;
    try {
      await unregisterPushForLogout();
      await signOut();
      await forgetAccount();
      if (email) await removeLocalLedger(email);
      startSession(null, false);
      return true;
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Could not sign out.");
      return false;
    } finally {
      operation.current = false;
    }
  }

  return {
    email, checking, demo, ledger, syncing, syncError, pending, toast, toastKind, toastSequence, sessionKey, sync, commit, showToast, logout,
    login: (address: string) => startSession(address, false),
    openDemo: () => startSession(null, true),
    leaveDemo: () => startSession(null, false),
  };
}

const LedgerContext = createContext<ReturnType<typeof useLedgerSession> | null>(null);

export function LedgerProvider({ children }: React.PropsWithChildren) {
  const value = useLedgerSession();
  return <LedgerContext.Provider value={value}>
    <PushRegistration email={value.email} demo={value.demo} />
    {children}
  </LedgerContext.Provider>;
}

export function useLedger() {
  const value = useContext(LedgerContext);
  if (!value) throw new Error("useLedger must be used within LedgerProvider");
  return value;
}
