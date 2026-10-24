import { StyleSheet, Text, View } from "react-native";
import { C, Icon, s } from "../../../shared/ui";

type SummaryCardsProps = {
  summary: { income: number; expense: number; investment: number };
  compact: boolean;
  money: (value: number) => string;
  period?: "month" | "year";
  projected?: boolean;
};

export function SummaryCards({ summary, compact, money, period = "month", projected = false }: SummaryCardsProps) {
  const a = makeStyles();

  return (
    <View
      style={[
        s.row,
        { alignItems: "stretch", flexWrap: "wrap", gap: compact ? 8 : 18 },
      ]}
    >
      {[
        {
          label: "Income",
          amount: summary.income,
          icon: "arrow-down-outline",
          color: C.green,
          bg: C.pale,
          hint: "Money coming your way",
        },
        {
          label: "Expenses",
          amount: summary.expense,
          icon: "arrow-up-outline",
          color: C.accent,
          bg: C.orangeBg,
          hint: "Your share of spending",
        },
        {
          label: "Invested",
          amount: summary.investment,
          icon: "trending-up-outline",
          color: C.blue,
          bg: C.pale,
          hint: "Contributions, not portfolio value",
        },
        {
          label: projected ? "Projected remaining" : "Cash remaining",
          amount: summary.income - summary.expense - summary.investment,
          icon: "wallet-outline",
          color: C.ink,
          bg: C.pale,
          hint: `This ${period}, after expenses and investing`,
        },
      ].map((stat, i) => (
        <View
          key={stat.label}
          style={[
            a.stat,
            { padding: compact ? 13 : 23, flexBasis: compact ? "45%" : 0 },
            i === 3 && {
              backgroundColor: C.pale,
              borderColor: C.line,
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
              {stat.hint}
            </Text>
          )}
        </View>
      ))}
    </View>

  );
}

const makeStyles = () => StyleSheet.create({
  stat: {
    backgroundColor: C.paper,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 18,
    flex: 1,
  },
});
