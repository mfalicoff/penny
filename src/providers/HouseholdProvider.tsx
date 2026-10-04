import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { useLedger } from "./LedgerProvider";
import * as householdsApi from "../data/households";
import type { Household, ProjectedExpense } from "../data/households";

function useHouseholdState() {
  const { email, demo, ledger } = useLedger();
  const [households, setHouseholds] = useState<Household[]>([]);
  const [byPeriod, setByPeriod] = useState<Record<string, ProjectedExpense[]>>({});
  const [loading, setLoading] = useState(Boolean(email && !demo));
  const [error, setError] = useState("");
  const session = useRef(0);
  const requested = useRef(new Set<string>());
  const sequence = useRef(new Map<string, number>());

  const loadProjection = useCallback(async (period: string) => {
    if (!email || demo || !/^\d{4}(-(?:0[1-9]|1[0-2]))?$/.test(period)) return;
    requested.current.add(period);
    const generation = session.current;
    const current = (sequence.current.get(period) ?? 0) + 1;
    sequence.current.set(period, current);
    try {
      const result = await householdsApi.getProjection(period);
      if (generation === session.current && sequence.current.get(period) === current)
        setByPeriod((previous) => ({ ...previous, [period]: result.transactions }));
    } catch (failure) {
      if (generation === session.current) setError(failure instanceof Error ? failure.message : "Could not load shared expenses.");
    }
  }, [email, demo]);

  const refresh = useCallback(async () => {
    if (!email || demo) return;
    const generation = session.current;
    setLoading(true);
    try {
      const list = await householdsApi.listHouseholds();
      if (generation !== session.current) return;
      setHouseholds(list.households);
      const mismatch = list.households.find((household) => household.currency !== ledger.currency);
      setError(mismatch ? `${mismatch.name} uses ${mismatch.currency}, but your personal ledger uses ${ledger.currency}. Shared entries in different currencies cannot be included in one report.` : "");
      await Promise.all([...requested.current].map(loadProjection));
    } catch (failure) {
      if (generation === session.current) setError(failure instanceof Error ? failure.message : "Could not load households.");
    } finally {
      if (generation === session.current) setLoading(false);
    }
  }, [email, demo, ledger.currency, loadProjection]);

  useEffect(() => {
    const generation = ++session.current;
    requested.current.clear(); sequence.current.clear();
    if (!email || demo) return () => { if (session.current === generation) session.current++; };
    void Promise.resolve().then(refresh);
    const timer = setInterval(() => {
      if (Platform.OS === "web" || AppState.currentState === "active") void refresh();
    }, 30000);
    const listener = AppState.addEventListener("change", (state) => { if (state === "active") void refresh(); });
    // Invalidate requests started by this subscription after it is removed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { if (session.current === generation) session.current++; clearInterval(timer); listener.remove(); };
  }, [email, demo, refresh]);

  const projection = useMemo(() => {
    const unique = new Map<string, ProjectedExpense>();
    for (const group of Object.values(byPeriod)) for (const item of group) unique.set(`${item.householdId}:${item.id}`, item);
    return [...unique.values()];
  }, [byPeriod]);

  return { households, projection, loading, error, refresh, loadProjection };
}

const HouseholdContext = createContext<ReturnType<typeof useHouseholdState> | null>(null);
export function HouseholdProvider({ children }: React.PropsWithChildren) {
  const value = useHouseholdState();
  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}
export function useHouseholds() {
  const value = useContext(HouseholdContext);
  if (!value) throw new Error("useHouseholds must be used within HouseholdProvider");
  return value;
}
