import { Pressable, Text, View } from "react-native";
import { dateKey, type Transaction } from "../../../domain/ledger";
import { C, Icon, s } from "../../../shared/ui";
import { calendarMonth } from "../selectors";

type MonthCalendarProps = {
  month: string;
  day: string | null;
  setDay: (day: string | null) => void;
  monthLabel: string;
  monthEntries: Transaction[];
  compact: boolean;
  desktop: boolean;
};

export function MonthCalendar({
  month, day, setDay, monthLabel, monthEntries, compact, desktop,
}: MonthCalendarProps) {
  const { daysInMonth, offset, calendarCells } = calendarMonth(month);
  return (
    <View
      style={[
        s.card,
        {
          flex: desktop ? 1.45 : undefined,
          padding: compact ? 16 : 24,
        },
      ]}
    >
      <View style={[s.between, { marginBottom: 22 }]}>
        <Text style={s.heading}>A month in little moments</Text>
        <Icon name="calendar-outline" color={C.muted} size={18} />
      </View>
      <View style={s.row}>
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <Text
            key={i}
            style={{
              flex: 1,
              textAlign: "center",
              fontSize: 10,
              color: C.muted,
              paddingBottom: 12,
            }}
          >
            {d}
          </Text>
        ))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {Array.from({ length: calendarCells }, (_, index) => {
          const n = index - offset + 1;
          const date = `${month}-${String(n).padStart(2, "0")}`;
          const today = date === dateKey();
          const selected = day === date;
          const entries = monthEntries.filter(
            (t) => t.date === date,
          );
          const hasIncome = entries.some(
            (t) => t.kind === "income",
          );
          const hasExpense = entries.some(
            (t) => t.kind === "expense",
          );
          return (
            <View
              key={index}
              style={{ width: `${100 / 7}%`, padding: 2 }}
            >
              {n > 0 && n <= daysInMonth ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${monthLabel} ${n}${entries.length ? `, ${entries.length} entries` : ""}`}
                  accessibilityState={{ selected }}
                  onPress={() =>
                    setDay(day === date ? null : date)
                  }
                  style={{
                    height: compact ? 44 : 48,
                    borderRadius: 11,
                    justifyContent: "center",
                    alignItems: "center",
                    gap: 5,
                    backgroundColor: selected
                      ? C.ink
                      : today
                        ? C.orangeBg
                        : "transparent",
                  }}
                >
                  <Text
                    style={{
                      color: selected
                        ? "#fff"
                        : today
                          ? C.accent
                          : C.ink,
                      fontWeight:
                        today || selected ? "700" : "400",
                      fontSize: 12,
                    }}
                  >
                    {n}
                  </Text>
                  <View
                    style={{
                      flexDirection: "row",
                      height: 4,
                      gap: 3,
                    }}
                  >
                    {hasExpense && (
                      <View
                        style={{
                          width: 4,
                          height: 4,
                          borderRadius: 4,
                          backgroundColor: C.accent,
                        }}
                      />
                    )}
                    {hasIncome && (
                      <View
                        style={{
                          width: 4,
                          height: 4,
                          borderRadius: 4,
                          backgroundColor: "#79A185",
                        }}
                      />
                    )}
                  </View>
                </Pressable>
              ) : (
                <View style={{ height: compact ? 44 : 48 }} />
              )}
            </View>
          );
        })}
      </View>
      <View
        style={[
          s.row,
          { justifyContent: "center", paddingTop: 18, gap: 16 },
        ]}
      >
        {[
          [C.green, "Income"],
          [C.accent, "Expense"],
        ].map(([color, label]) => (
          <View key={label} style={[s.row, { gap: 5 }]}>
            <View
              style={{
                width: 5,
                height: 5,
                borderRadius: 5,
                backgroundColor: color,
              }}
            />
            <Text style={{ color: C.muted, fontSize: 10 }}>
              {label}
            </Text>
          </View>
        ))}
        {day && (
          <Pressable
            accessibilityRole="button"
            onPress={() => setDay(null)}
          >
            <Text style={{ color: C.accent, fontSize: 11 }}>
              Show whole month
            </Text>
          </Pressable>
        )}
      </View>
    </View>

  );
}
