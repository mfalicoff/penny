import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { parseDate, type Trip } from "../../domain/ledger";
import { useLedger } from "../../providers/LedgerProvider";
import { currencyFormat } from "../../shared/format";
import { Button, C, Icon, s } from "../../shared/ui";
import { useTheme } from "../../shared/theme";
import { useResponsive } from "../../shared/useResponsive";
import { TripForm } from "./TripForm";
import { tripSummaries } from "./selectors";

export default function TripsScreen() {
  useTheme();
  const { ledger, commit } = useLedger();
  const { compact } = useResponsive();
  const [editing, setEditing] = useState<Trip | null | undefined>(undefined);
  const trips = [...ledger.trips].sort((a, b) => b.startDate.localeCompare(a.startDate));
  const summaries = useMemo(() => tripSummaries(ledger.transactions), [ledger.transactions]);
  return <View style={{ gap: 20 }}>
    <View style={[s.between, compact && { alignItems: "flex-start", flexDirection: "column" }]}>
      <Text style={s.muted}>Keep travel spending together, even when you pay before or after the trip.</Text>
      <Button title="Create trip" icon="add" onPress={() => setEditing(null)} />
    </View>
    {!trips.length && <View style={[s.card, { alignItems: "center", gap: 12 }]}>
      <Icon name="airplane-outline" color={C.green} size={32} />
      <Text style={s.heading}>Your next trip starts here.</Text>
      <Text style={[s.muted, { textAlign: "center" }]}>Create a trip, then assign expenses to see its total and breakdown.</Text>
    </View>}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
      {trips.map((trip) => {
        const summary = summaries.get(trip.id);
        return <Pressable key={trip.id} accessibilityRole="button" accessibilityLabel={`Open trip ${trip.name}`}
          onPress={() => router.push({ pathname: "/trips/[id]", params: { id: trip.id } })}
          style={[s.card, { width: compact ? "100%" : "48%", padding: 20, gap: 14 }]}>
          <View style={s.between}>
            <Icon name="airplane-outline" color={C.green} size={25} />
            <Icon name="chevron-forward" color={C.muted} size={18} />
          </View>
          <Text style={s.heading}>{trip.name}</Text>
          <Text style={s.muted}>{parseDate(trip.startDate).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })} – {parseDate(trip.endDate).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}</Text>
          <View style={s.between}>
            <Text style={{ color: C.ink, fontSize: 22, fontWeight: "600" }}>{currencyFormat(summary?.total ?? 0, ledger.currency)}</Text>
            <Text style={s.muted}>{summary?.count ?? 0} expenses</Text>
          </View>
        </Pressable>;
      })}
    </View>
    {editing !== undefined && <TripForm trip={editing ?? undefined} commit={commit} onClose={() => setEditing(undefined)} />}
  </View>;
}
