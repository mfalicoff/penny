import { StyleSheet, Text, View } from "react-native";
import { type Category } from "../../../domain/ledger";
import { C, Icon, s } from "../../../shared/ui";

type SpendingBreakdownProps = {
  spending: (Category & { amount: number })[];
  summary: { expense: number };
  desktop: boolean;
  money: (value: number) => string;
};

export function SpendingBreakdown({
  spending, summary, desktop, money,
}: SpendingBreakdownProps) {
  const a = makeStyles();

  return (
    <View
      style={[
        s.card,
        { flex: desktop ? 1 : undefined, minHeight: 300 },
      ]}
    >
      <View style={[s.between, { marginBottom: 24 }]}>
        <Text style={s.heading}>Where it went</Text>
        <Icon
          name="pie-chart-outline"
          color={C.muted}
          size={18}
        />
      </View>
      {spending.length ? (
        <View style={{ gap: 19 }}>
          {spending.slice(0, 5).map((c) => (
            <View key={c.id} style={{ gap: 9 }}>
              <View style={s.between}>
                <View style={[s.row, { gap: 8 }]}>
                  <Icon name={c.icon} size={16} color={c.color} />
                  <Text style={{ color: C.ink, fontSize: 12 }}>
                    {c.name}
                  </Text>
                </View>
                <Text
                  style={{
                    color: C.ink,
                    fontSize: 12,
                    fontWeight: "600",
                  }}
                >
                  {money(c.amount)}
                </Text>
              </View>
              <View
                style={{
                  height: 5,
                  backgroundColor: C.bg,
                  borderRadius: 4,
                }}
              >
                <View
                  style={{
                    height: 5,
                    width: `${(c.amount / summary.expense) * 100}%`,
                    backgroundColor: c.color,
                    borderRadius: 4,
                  }}
                />
              </View>
            </View>
          ))}
          <Text
            style={{ fontSize: 10, color: C.muted, marginTop: 1 }}
          >
            {spending.length > 5 ? "Top 5 categories · " : ""}
            Based on your share, including split receipts.
          </Text>
        </View>
      ) : (
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            gap: 12,
            paddingVertical: 36,
          }}
        >
          <View style={a.emptyIcon}>
            <Icon
              name="pie-chart-outline"
              size={28}
              color={C.green}
            />
          </View>
          <Text style={{ color: C.ink, fontSize: 14 }}>
            A fresh start.
          </Text>
          <Text
            style={[
              s.muted,
              { textAlign: "center", maxWidth: 210 },
            ]}
          >
            Add an expense and your spending picture will take
            shape here.
          </Text>
        </View>
      )}
    </View>

  );
}

const makeStyles = () => StyleSheet.create({
  emptyIcon: {
    width: 60,
    height: 60,
    borderRadius: 22,
    backgroundColor: C.pale,
    justifyContent: "center",
    alignItems: "center",
  },
});
