import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { ApiError, fetchLedger, mutateLedger, signOut, whoAmI } from "../data/api";
import type { LedgerChange } from "../domain/commands";
import { demoLedger, emptyLedger, materialize, type Kind, type Ledger } from "../domain/ledger";

function useLedgerSession() {
  const [email, setEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [demo, setDemo] = useState(false);
  const [ledger, setLedger] = useState<Ledger>(emptyLedger);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [toast, setToast] = useState("");
  const [toastKind, setToastKind] = useState<Kind | null>(null);
  const [toastSequence, setToastSequence] = useState(0);
  const [sessionKey, setSessionKey] = useState(0);
  const ledgerRef = useRef(ledger);
  const operation = useRef(false);
  const generation = useRef(0);

  function replaceLedger(next: Ledger) {
    ledgerRef.current = next;
    setLedger(next);
  }

  // Async results belong to the session that started them, including startup checks.
  useEffect(() => {
    const session = generation;
    const current = session.current;
    whoAmI().then((address) => {
      if (current === generation.current) setEmail(address);
    }).catch((error) => {
      if (current === generation.current && error instanceof ApiError && error.status !== 401)
        setSyncError(error.message);
    }).finally(() => {
      if (current === generation.current) setChecking(false);
    });
    return () => { session.current++; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast, toastSequence]);

  const sync = useCallback(async () => {
    if (!email || demo || operation.current) return;
    const current = generation.current;
    operation.current = true;
    setSyncing(true);
    try {
      let snapshot = await fetchLedger();
      if (current !== generation.current) return;
      const due = materialize(snapshot.ledger);
      if (JSON.stringify(due) !== JSON.stringify(snapshot.ledger))
        snapshot = await mutateLedger((value) => value);
      if (current === generation.current) {
        replaceLedger(snapshot.ledger);
        setSyncError("");
      }
    } catch (error) {
      if (current === generation.current)
        setSyncError(error instanceof Error ? error.message : "Sync failed. Please try again.");
    } finally {
      if (current === generation.current) {
        operation.current = false;
        setSyncing(false);
      }
    }
  }, [email, demo]);

  useEffect(() => {
    if (!email || demo) return;
    // Initial fetch updates the loading indicator while synchronizing with the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void sync();
    const timer = setInterval(() => {
      if (AppState.currentState === "active" || Platform.OS === "web") void sync();
    }, 15000);
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void sync();
    });
    return () => { clearInterval(timer); listener.remove(); };
  }, [sync, email, demo]);

  async function commit(change: LedgerChange, message: string, feedbackKind?: Kind) {
    if (operation.current) throw new Error("Sync is finishing. Please try again in a moment.");
    if (!email && !demo) throw new Error("Sign in before saving an entry.");
    const current = generation.current;
    operation.current = true;
    setSyncing(true);
    try {
      const next = demo ? materialize(change(ledgerRef.current)) : (await mutateLedger(change)).ledger;
      if (current !== generation.current) throw new Error("Your session changed. Reopen this entry before saving.");
      replaceLedger(next);
      setSyncError("");
      setToast(message);
      setToastKind(feedbackKind ?? null);
      setToastSequence((value) => value + 1);
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
    setChecking(false);
    replaceLedger(isDemo ? demoLedger() : emptyLedger());
    setSyncing(false);
    setSyncError("");
    setToast("");
    setToastKind(null);
  }

  async function logout() {
    if (operation.current) return false;
    operation.current = true;
    try {
      await signOut();
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
    email, checking, demo, ledger, syncing, syncError, toast, toastKind, toastSequence, sessionKey, sync, commit, logout,
    login: (address: string) => startSession(address, false),
    openDemo: () => startSession(null, true),
    leaveDemo: () => startSession(null, false),
  };
}

const LedgerContext = createContext<ReturnType<typeof useLedgerSession> | null>(null);

export function LedgerProvider({ children }: React.PropsWithChildren) {
  const value = useLedgerSession();
  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

export function useLedger() {
  const value = useContext(LedgerContext);
  if (!value) throw new Error("useLedger must be used within LedgerProvider");
  return value;
}
