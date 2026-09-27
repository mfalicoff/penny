import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { removeSchedule, setScheduleActive } from "../../domain/commands";
import { parseDate, type Recurring } from "../../domain/ledger";
import { useLedger } from "../../providers/LedgerProvider";
import { useWorkspace } from "../../providers/WorkspaceProvider";
import { currencyFormat } from "../../shared/format";
import { Button, C, Icon, IconButton, Sheet, Tag, s } from "../../shared/ui";
import { useResponsive } from "../../shared/useResponsive";

export default function RecurringScreen() {
  const { ledger } = useLedger();
  const { compact } = useResponsive();
  const { setForm } = useWorkspace();
  const { commit } = useLedger();
  const [confirmRule, setConfirmRule] = React.useState<Recurring>();
  const money = (value: number) => currencyFormat(value, ledger.currency);
  return (<View style={{ gap: 26 }}>
    <View style={[s.card, { backgroundColor: C.pale, gap: 8 }]}>
      <View style={s.row}>
        <Icon name="repeat-outline" color={C.green} />
        <Text style={s.heading}>A little less to remember.</Text>
      </View>
      <Text style={s.muted}>
        Choose a repeat schedule when adding an entry. Due entries
        are added once when you open the app. Pausing a schedule
        skips its paused dates.
      </Text>
    </View>
    {ledger.recurring.length ? (
      ledger.recurring.map((rule) => {
        const c = ledger.categories.find(
          (c) => c.id === rule.categoryId,
        );
        return (
          <View key={rule.id} style={[s.card, { gap: 20 }]}>
            <View style={s.row}>
              <View
                style={[
                  a.categoryIcon,
                  { backgroundColor: `${c?.color}15` },
                ]}
              >
                <Icon
                  name={c?.icon ?? "repeat-outline"}
                  color={c?.color}
                />
              </View>
              <View style={{ flex: 1, gap: 5 }}>
                <Text
                  style={{
                    color: C.ink,
                    fontSize: 16,
                    fontWeight: "600",
                  }}
                >
                  {rule.title}
                </Text>
                <Text style={s.muted}>
                  {rule.frequency[0].toUpperCase() +
                    rule.frequency.slice(1)}{" "}
                  · {c?.name}
                </Text>
              </View>
              <Text
                style={{
                  color: rule.kind === "income" ? C.green : rule.kind === "investment" ? C.blue : C.ink,
                  fontSize: 20,
                  fontWeight: "500",
                }}
              >
                {rule.kind === "income" ? "+" : "−"}
                {money(rule.share)}
              </Text>
            </View>
            <View
              style={[s.between, compact && { flexWrap: "wrap" }]}
            >
              <Tag
                text={
                  rule.active
                    ? `NEXT · ${parseDate(rule.nextDate).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}`
                    : "PAUSED"
                }
                color={rule.active ? C.green : C.muted}
              />
              <View style={s.row}>
                <Button
                  title={rule.active ? "Pause" : "Resume"}
                  tone="quiet"
                  icon={
                    rule.active ? "pause-outline" : "play-outline"
                  }
                  onPress={async () => {
                    try {
                      await commit(
                        setScheduleActive(rule.id, !rule.active),
                        rule.active
                          ? "Schedule paused"
                          : "Schedule resumed",
                      );
                    } catch { }
                  }}
                />
                <IconButton
                  icon="trash-outline"
                  label={`Delete ${rule.title} schedule`}
                  onPress={() => setConfirmRule(rule)}
                />
              </View>
            </View>
          </View>
        );
      })
    ) : (
      <View
        style={[
          s.card,
          { alignItems: "center", gap: 16, padding: 44 },
        ]}
      >
        <View style={a.emptyIcon}>
          <Icon name="repeat-outline" size={28} color={C.green} />
        </View>
        <Text style={s.heading}>Rent, payday, the usuals.</Text>
        <Text style={[s.muted, { textAlign: "center" }]}>
          Add an entry and choose weekly, monthly, or yearly to give
          it a routine.
        </Text>
        <Button
          title="Add a recurring entry"
          icon="add"
          onPress={() => setForm({})}
        />
      </View>
    )}
    <Sheet
      visible={!!confirmRule}
      title="Remove this schedule?"
      onClose={() => setConfirmRule(undefined)}
    >
      <Text style={s.muted}>
        Future entries for {confirmRule?.title} will stop. Entries already
        recorded will stay in your history.
      </Text>
      <Button
        title="Remove schedule"
        tone="danger"
        onPress={async () => {
          try {
            await commit(
              removeSchedule(confirmRule!.id),
              "Schedule removed",
            );
            setConfirmRule(undefined);
          } catch { }
        }}
      />
    </Sheet>
  </View>);
}

const a = StyleSheet.create({
  emptyIcon: {
    width: 60,
    height: 60,
    borderRadius: 22,
    backgroundColor: C.pale,
    justifyContent: "center",
    alignItems: "center",
  },
  categoryIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
});
