import { useEffect, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { dateKey, parseDate } from "../../domain/ledger";
import { useLedger } from "../../providers/LedgerProvider";
import { useHouseholds } from "../../providers/HouseholdProvider";
import { ledgerWithHouseholds } from "../households/projection";
import { useWorkspace } from "../../providers/WorkspaceProvider";
import { currencyFormat } from "../../shared/format";
import { C, IconButton, s } from "../../shared/ui";
import { useTheme } from "../../shared/theme";
import { useResponsive } from "../../shared/useResponsive";
import { EntryList } from "./components/EntryList";
import { MoneyFlowChart } from "./components/MoneyFlowChart";
import { MonthCalendar } from "./components/MonthCalendar";
import { SpendingBreakdown } from "./components/SpendingBreakdown";
import { SummaryCards } from "./components/SummaryCards";
import { selectOverview, shiftMonthKey } from "./selectors";

export default function OverviewScreen() {
  useTheme();
  const { ledger: privateLedger } = useLedger();
  const { projection, households, loadProjection } = useHouseholds();
  const ledger = useMemo(() => ledgerWithHouseholds(privateLedger, projection, households), [privateLedger, projection, households]);
  const { month, setMonth, day, setDay, filter, setFilter, search, setSearch, setForm } = useWorkspace();
  useEffect(() => { void loadProjection(month); }, [month, loadProjection]);
  const { compact, desktop } = useResponsive();
  const { monthEntries, calendarEntries, summary, visibleEntries, grouped, spending } = useMemo(() => selectOverview(ledger, { month, day, filter, search }), [ledger, month, day, filter, search]);
  const monthLabel = parseDate(`${month}-01`).toLocaleDateString("en-CA", { month: "long", year: "numeric" });
  const money = (value: number) => currencyFormat(value, ledger.currency);
  function shiftMonth(delta: number) { setMonth(shiftMonthKey(month, delta)); setDay(null); }
  return (<View style={{ gap: 26 }}>

    <View style={s.between}>
      <View style={[s.row, { gap: 4 }]}>
        <IconButton
          icon="chevron-back"
          label="Previous month"
          onPress={() => shiftMonth(-1)}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go to current month"
          onPress={() => {
            setMonth(dateKey().slice(0, 7));
            setDay(null);
          }}
        >
          <Text
            style={{
              color: C.ink,
              fontSize: 16,
              fontWeight: "600",
              minWidth: compact ? 150 : 165,
              textAlign: "center",
            }}
          >
            {monthLabel}
          </Text>
        </Pressable>
        <IconButton
          icon="chevron-forward"
          label="Next month"
          onPress={() => shiftMonth(1)}
        />
      </View>
      <Text style={{ fontSize: 11, color: C.muted }}>
        {ledger.currency}
      </Text>
    </View>

    <SummaryCards summary={summary} compact={compact} money={money} />
    <View style={{ flexDirection: desktop ? "row" : "column", gap: 22, alignItems: "stretch" }}>
      <MonthCalendar monthEntries={calendarEntries} {...{ month, day, setDay, monthLabel, compact, desktop }} />
      <SpendingBreakdown {...{ spending, summary, desktop, money }} />
    </View>
    <MoneyFlowChart key={month} entries={monthEntries} categories={ledger.categories} currency={ledger.currency} monthLabel={monthLabel} />
    <EntryList {...{ day, filter, search, setFilter, setSearch, visibleEntries, grouped, ledger, compact, money, setForm }} />
  </View>);
}
