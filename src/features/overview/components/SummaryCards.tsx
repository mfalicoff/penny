import { StyleSheet, Text, View } from "react-native";
import { C, Icon, s } from "../../../shared/ui";

type SummaryCardsProps = {
  summary: { income: number; expense: number };
  compact: boolean;
  money: (value: number) => string;
};

export function SummaryCards({ summary, compact, money }: SummaryCardsProps) {

  return (
    <View
      style={[
        s.row,
        { alignItems: "stretch", gap: compact ? 8 : 18 },
      ]}
    >
      {[
        {
          label: "Income",
          amount: summary.income,
          icon: "arrow-down-outline",
          color: C.green,
          bg: C.pale,
        },
        {
          label: "Expenses",
          amount: summary.expense,
          icon: "arrow-up-outline",
          color: C.accent,
          bg: C.orangeBg,
        },
        {
          label: "Net income",
          amount: summary.income - summary.expense,
          icon: "wallet-outline",
          color: C.ink,
          bg: "#E9EEE6",
        },
      ].map((stat, i) => (
        <View
          key={stat.label}
          style={[
            a.stat,
            { padding: compact ? 13 : 23 },
            i === 2 && {
              backgroundColor: "#EEF2E9",
              borderColor: "#E3E9DC",
            },
          ]}
        >
          <View style={[s.between, { gap: 3 }]}>
            <Text
              style={{
                fontSize: compact ? 10 : 12,
                color: C.muted,
              }}
            >
              {stat.label}
            </Text>
            {!compact && (
              <View
                style={{
                  backgroundColor: stat.bg,
                  padding: 7,
                  borderRadius: 10,
                }}
              >
                <Icon
                  name={stat.icon}
                  size={16}
                  color={stat.color}
                />
              </View>
            )}
          </View>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            style={{
              fontSize: compact ? 21 : 30,
              letterSpacing: -1,
              color: stat.color,
              fontWeight: "500",
              marginTop: compact ? 12 : 14,
            }}
          >
            {money(stat.amount)}
          </Text>
          {!compact && (
            <Text
              style={{ fontSize: 10, color: C.muted, marginTop: 7 }}
            >
              {i === 0
                ? "Money coming your way"
                : i === 1
                  ? "Your share of spending"
                  : "Income minus expenses"}
            </Text>
          )}
        </View>
      ))}
    </View>

  );
}

const a = StyleSheet.create({
  stat: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 18,
    flex: 1,
  },
});
