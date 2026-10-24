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
  const { projection, households, projectionByPeriod, loadProjection } = useHouseholds();
  const { month, setMonth, day, setDay, filter, setFilter, categoryId, setCategoryId, search, setSearch, setForm } = useWorkspace();
  const ledger = useMemo(() => ledgerWithHouseholds(privateLedger, [...projection, ...(projectionByPeriod[month]?.scheduled ?? [])], households), [privateLedger, projection, projectionByPeriod, month, households]);
  useEffect(() => { void loadProjection(month); }, [month, loadProjection]);
  const { compact, desktop } = useResponsive();
  const selectedCategory = ledger.categories.find((category) => category.id === categoryId && (filter === "all" || category.kind === filter)) ?? null;
  const activeCategoryId = selectedCategory?.id ?? null;
  const { summaryEntries, expectedIncome, calendarEntries, summary, visibleEntries, grouped, spending } = useMemo(() => selectOverview(ledger, { month, day, filter, categoryId: activeCategoryId, search }), [ledger, month, day, filter, activeCategoryId, search]);
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

    <SummaryCards summary={summary} compact={compact} money={money} projected={expectedIncome > 0} />
    {expectedIncome > 0 && <Text style={s.muted}>
      Includes {money(expectedIncome)} in expected recurring income this month. Expenses and investments count recorded entries only. Projected remaining is not money available today.
    </Text>}
    <View style={{ flexDirection: desktop ? "row" : "column", gap: 22, alignItems: "stretch" }}>
      <MonthCalendar monthEntries={calendarEntries} {...{ month, day, setDay, monthLabel, compact, desktop }} />
      <SpendingBreakdown {...{ spending, summary, desktop, money }} />
    </View>
    <MoneyFlowChart key={month} entries={summaryEntries} categories={ledger.categories} currency={ledger.currency} monthLabel={monthLabel} />
    <EntryList {...{ day, filter, search, setSearch, visibleEntries, grouped, ledger, compact, money, setForm }}
      setFilter={(next) => {
        setFilter(next);
        if (next !== "all" && selectedCategory?.kind !== next) setCategoryId(null);
      }}
      categoryFilter={{ value: selectedCategory, onChange: setCategoryId }} />
  </View>);
}
