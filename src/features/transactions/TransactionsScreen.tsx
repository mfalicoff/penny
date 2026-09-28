import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { dateKey, parseDate } from "../../domain/ledger";
import { useLedger } from "../../providers/LedgerProvider";
import { useHouseholds } from "../../providers/HouseholdProvider";
import { ledgerWithHouseholds } from "../households/projection";
import { useWorkspace } from "../../providers/WorkspaceProvider";
import { currencyFormat } from "../../shared/format";
import { Button, Field, Icon, Sheet, s } from "../../shared/ui";
import { useResponsive } from "../../shared/useResponsive";
import { EntryList } from "../overview/components/EntryList";
import { SummaryCards } from "../overview/components/SummaryCards";
import { PAGE_SIZE, selectTransactions, shiftTransactionPeriod, type TransactionFilters } from "./selectors";

const months = Array.from({ length: 12 }, (_, index) => ({
  value: String(index + 1).padStart(2, "0"),
  label: new Date(2026, index, 1).toLocaleDateString("en-CA", { month: "short" }),
}));

export default function TransactionsScreen() {
  const { ledger: privateLedger } = useLedger();
  const { projection, households, loadProjection } = useHouseholds();
  const ledger = useMemo(() => ledgerWithHouseholds(privateLedger, projection, households), [privateLedger, projection, households]);
  const { transactionFilters: filters, setTransactionFilters, setForm } = useWorkspace();
  useEffect(() => { void loadProjection(filters.period === "year" ? filters.month.slice(0, 4) : filters.month); }, [filters.period, filters.month, loadProjection]);
  const { compact } = useResponsive();
  const [choosing, setChoosing] = useState(false);
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const result = useMemo(() => selectTransactions(ledger, filters), [ledger, filters]);
  const money = (value: number) => currencyFormat(value, ledger.currency);
  const periodLabel = filters.period === "year" ? filters.month.slice(0, 4)
    : parseDate(`${filters.month}-01`).toLocaleDateString("en-CA", { month: "long", year: "numeric" });
  const update = (patch: Partial<TransactionFilters>) => setTransactionFilters((current) => ({ ...current, page: 0, ...patch }));
  const validYear = /^\d{4}$/.test(year) && Number(year) >= 2000 && Number(year) <= 2100;
  const previous = shiftTransactionPeriod(filters.month, filters.period, -1);
  const next = shiftTransactionPeriod(filters.month, filters.period, 1);

  return (
    <View style={{ gap: 22 }}>
      <View style={[s.card, { padding: compact ? 16 : 24, gap: 16 }]}>
        <View style={[s.between, { flexWrap: "wrap" }]}>
          <View style={[s.row, { gap: 8 }]}>
            {(["month", "year"] as const).map((period) => (
              <Pressable key={period} accessibilityRole="button" accessibilityState={{ selected: filters.period === period }}
                onPress={() => update({ period })}
                style={[s.chip, { minHeight: 44 }, filters.period === period && s.chipActive]}>
                <Text style={s.label}>{period === "month" ? "By month" : "By year"}</Text>
              </Pressable>
            ))}
          </View>
          <Button title={filters.period === "month" ? "This month" : "This year"} tone="quiet"
            onPress={() => update({ month: dateKey().slice(0, 7) })} />
        </View>
        <View style={[s.row, { gap: compact ? 4 : 12 }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Previous ${filters.period}`}
            accessibilityState={{ disabled: previous === filters.month }} disabled={previous === filters.month}
            onPress={() => update({ month: previous })}
            style={[s.quiet, { minWidth: 44, minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", opacity: previous === filters.month ? 0.4 : 1 }]}>
            <Icon name="chevron-back" />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Choose ${filters.period}: ${periodLabel}`}
            onPress={() => { setYear(filters.month.slice(0, 4)); setMonth(filters.month.slice(5, 7)); setChoosing(true); }}
            style={[s.row, { flex: 1, minHeight: 48, justifyContent: "center", gap: 6 }]}>
            <Text style={[s.heading, { flexShrink: 1, textAlign: "center" }]}>{periodLabel}</Text>
            <Icon name="chevron-down" size={16} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Next ${filters.period}`}
            accessibilityState={{ disabled: next === filters.month }} disabled={next === filters.month}
            onPress={() => update({ month: next })}
            style={[s.quiet, { minWidth: 44, minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", opacity: next === filters.month ? 0.4 : 1 }]}>
            <Icon name="chevron-forward" />
          </Pressable>
        </View>
      </View>
      <SummaryCards summary={result.summary} compact={compact} money={money} period={filters.period} />
      <Text style={s.muted}>Totals for {periodLabel} · {ledger.currency} · Your share of recorded entries. Cash remaining is income minus expenses and investments.</Text>
      <EntryList day={null} filter={filters.filter} search={filters.search}
        setFilter={(filter) => update({ filter })} setSearch={(search) => update({ search })}
        visibleEntries={result.visibleEntries} grouped={result.grouped} totalCount={result.totalCount}
        periodLabel={periodLabel} ledger={ledger} compact={compact} money={money} setForm={setForm} />
      {result.pageCount > 1 && (
        <View style={{ gap: 12 }}>
          <Text style={[s.muted, { textAlign: "center" }]}>Showing {result.page * PAGE_SIZE + 1}–{Math.min((result.page + 1) * PAGE_SIZE, result.totalCount)} of {result.totalCount} entries</Text>
          <View style={s.between}>
            <Button title="Previous page" tone="quiet" disabled={result.page === 0} onPress={() => update({ page: result.page - 1 })} />
            <Button title="Next page" tone="quiet" disabled={result.page === result.pageCount - 1} onPress={() => update({ page: result.page + 1 })} />
          </View>
        </View>
      )}
      {choosing && <Sheet visible title={filters.period === "month" ? "Choose a month" : "Choose a year"} onClose={() => setChoosing(false)}>
        <Field label="Year" value={year} onChangeText={setYear} keyboardType="number-pad" maxLength={4} />
        {!validYear && <Text style={s.error}>Enter a year from 2000 to 2100.</Text>}
        {filters.period === "month" && (
          <View style={[s.row, { flexWrap: "wrap", gap: 8 }]}>
            {months.map((item) => (
              <Pressable key={item.value} accessibilityRole="button" accessibilityState={{ selected: month === item.value }}
                onPress={() => setMonth(item.value)} style={[s.chip, { flexBasis: "30%", flexGrow: 1, minHeight: 44, justifyContent: "center" }, month === item.value && s.chipActive]}>
                <Text style={s.label}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <Button title="Apply period" disabled={!validYear} onPress={() => { update({ month: `${year}-${month}` }); setChoosing(false); }} />
      </Sheet>}
    </View>
  );
}
