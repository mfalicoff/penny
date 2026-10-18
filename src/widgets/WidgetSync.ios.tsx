import { useEffect, useMemo } from "react";
import { dateKey } from "../domain/ledger";
import { ledgerWithHouseholds } from "../features/households/projection";
import { useHouseholds } from "../providers/HouseholdProvider";
import { useLedger } from "../providers/LedgerProvider";
import { BalanceChartWidget, RecentExpensesWidget, clearWidgetSnapshots } from "./PennyWidgets.ios";
import { widgetData } from "./widgetData";

export function WidgetSync() {
  const { ledger } = useLedger();
  const { households, projection, loadProjection } = useHouseholds();
  const month = dateKey().slice(0, 7);
  const combined = useMemo(() => ledgerWithHouseholds(ledger, projection, households), [ledger, projection, households]);
  const data = useMemo(() => widgetData(combined), [combined]);

  useEffect(() => { void loadProjection(month); }, [loadProjection, month]);
  useEffect(() => {
    BalanceChartWidget.updateSnapshot(data.chart);
    RecentExpensesWidget.updateSnapshot(data.recent);
  }, [data]);
  useEffect(() => () => { clearWidgetSnapshots(); }, []);
  return null;
}
