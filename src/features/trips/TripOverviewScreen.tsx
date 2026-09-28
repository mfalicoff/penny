import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { parseDate } from "../../domain/ledger";
import { useLedger } from "../../providers/LedgerProvider";
import { useWorkspace } from "../../providers/WorkspaceProvider";
import { currencyFormat } from "../../shared/format";
import { Button, C, Icon, s } from "../../shared/ui";
import { useResponsive } from "../../shared/useResponsive";
import { TripForm } from "./TripForm";
import { tripOverview } from "./selectors";

export default function TripOverviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { ledger, commit } = useLedger();
  const { setForm } = useWorkspace();
  const { compact } = useResponsive();
  const [editing, setEditing] = useState(false);
  const trip = ledger.trips.find((item) => item.id === id);
  if (!trip) return <View style={[s.card, { gap: 16 }]}>
    <Text style={s.heading}>Trip not found.</Text>
    <Button title="Back to trips" tone="quiet" onPress={() => router.navigate("/trips")} />
  </View>;
  const overview = tripOverview(ledger, trip);
  return <View style={{ gap: 20 }}>
    <Button title="All trips" icon="arrow-back" tone="quiet" onPress={() => router.navigate("/trips")} style={{ alignSelf: "flex-start" }} />
    <View style={[s.card, { gap: 16 }]}>
      <View style={[s.between, compact && { alignItems: "flex-start", flexDirection: "column" }]}>
        <View style={{ gap: 6 }}>
          <Text style={[s.heading, { fontSize: 24 }]}>{trip.name}</Text>
          <Text style={s.muted}>{parseDate(trip.startDate).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" })} – {parseDate(trip.endDate).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" })}</Text>
        </View>
        <Button title="Edit trip" icon="create-outline" tone="quiet" onPress={() => setEditing(true)} />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        <View style={[s.card, { backgroundColor: C.pale, flexGrow: 1, minWidth: 140, gap: 6 }]}>
          <Text style={s.label}>YOUR SPENDING</Text>
          <Text style={[s.heading, { fontSize: 26 }]}>{currencyFormat(overview.total, ledger.currency)}</Text>
        </View>
        <View style={[s.card, { backgroundColor: C.bg, flexGrow: 1, minWidth: 140, gap: 6 }]}>
          <Text style={s.label}>EXPENSES</Text>
          <Text style={[s.heading, { fontSize: 26 }]}>{overview.expenses.length}</Text>
        </View>
      </View>
      {overview.receiptTotal !== overview.total && <Text style={s.muted}>Receipt total: {currencyFormat(overview.receiptTotal, ledger.currency)}. Your share counts toward trip spending.</Text>}
      <Button title="Add expense to trip" icon="add" onPress={() => setForm({ tripId: trip.id })} style={{ alignSelf: compact ? undefined : "flex-start" }} />
    </View>
    <View style={[s.card, { gap: 16 }]}>
      <Text style={s.heading}>By category</Text>
      {overview.categories.length ? overview.categories.map((category) => <View key={category.id} style={s.between}>
        <View style={s.row}><Icon name={category.icon} color={category.color} size={20} /><Text style={{ color: C.ink }}>{category.name}</Text></View>
        <Text style={{ color: C.ink, fontWeight: "600" }}>{currencyFormat(category.amount, ledger.currency)}</Text>
      </View>) : <Text style={s.muted}>Assign an expense to see where the trip money went.</Text>}
    </View>
    <View style={[s.card, { gap: 8 }]}>
      <Text style={s.heading}>Trip expenses</Text>
      {overview.expenses.length ? overview.expenses.map((entry) => <Pressable key={entry.id} accessibilityRole="button" accessibilityLabel={`Edit ${entry.title}`}
        onPress={() => setForm({ entry })} style={[s.between, { minHeight: 60, borderBottomWidth: 1, borderColor: C.line }]}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: C.ink, fontWeight: "500" }}>{entry.title}</Text>
          <Text style={s.muted}>{parseDate(entry.date).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })} · {ledger.categories.find((category) => category.id === entry.categoryId)?.name}</Text>
        </View>
        <Text style={{ color: C.ink, fontWeight: "600" }}>{currencyFormat(entry.share, ledger.currency)}</Text>
        <Icon name="chevron-forward" color={C.muted} size={16} />
      </Pressable>) : <Text style={s.muted}>No expenses assigned yet.</Text>}
    </View>
    {editing && <TripForm trip={trip} used={overview.expenses.length > 0} commit={commit} onClose={() => setEditing(false)} onRemoved={() => router.navigate("/trips")} />}
  </View>;
}
