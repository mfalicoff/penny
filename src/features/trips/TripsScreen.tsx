import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { joinHousehold } from "../../data/households";
import { parseDate, type Trip } from "../../domain/ledger";
import { useLedger } from "../../providers/LedgerProvider";
import { useHouseholds } from "../../providers/HouseholdProvider";
import { currencyFormat } from "../../shared/format";
import { Button, C, Field, Icon, s, Sheet } from "../../shared/ui";
import { useTheme } from "../../shared/theme";
import { useResponsive } from "../../shared/useResponsive";
import { TripForm } from "./TripForm";
import { SharedTripForm } from "./SharedTripForm";
import { tripSummaries } from "./selectors";

export default function TripsScreen() {
  useTheme();
  const { ledger, commit, demo } = useLedger();
  const { households, refresh } = useHouseholds();
  const { compact } = useResponsive();
  const [editing, setEditing] = useState<Trip | null | undefined>(undefined);
  const [creatingShared, setCreatingShared] = useState(false);
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState("");
  const [joinError, setJoinError] = useState("");
  const [busy, setBusy] = useState(false);
  const sharedTrips = households.filter((household) => household.trip);
  const trips = [...ledger.trips].filter((trip) => !trip.sharedHouseholdId || !sharedTrips.some((shared) => shared.id === trip.sharedHouseholdId)).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const summaries = useMemo(() => tripSummaries(ledger.transactions), [ledger.transactions]);
  async function join() {
    if (busy) return;
    setBusy(true); setJoinError("");
    try {
      const { household } = await joinHousehold(code.trim().toUpperCase());
      await refresh();
      setJoining(false); setCode("");
      if (household.trip) router.push({ pathname: "/trips/[id]", params: { id: household.id } });
      else router.push(`/households/${household.id}`);
    } catch (cause) { setJoinError(cause instanceof Error ? cause.message : "Could not join this trip."); }
    finally { setBusy(false); }
  }
  return <View style={{ gap: 20 }}>
    <View style={[s.between, compact && { alignItems: "flex-start", flexDirection: "column" }]}>
      <Text style={s.muted}>Keep travel spending together, even when you pay before or after the trip.</Text>
      <View style={[s.row, { flexWrap: "wrap" }]}>
        {!demo && <><Button title="Create shared trip" icon="people-outline" onPress={() => setCreatingShared(true)} />
          <Button title="Join trip" tone="quiet" icon="key-outline" onPress={() => { setJoinError(""); setJoining(true); }} /></>}
        <Button title="Personal trip" tone="quiet" icon="add" onPress={() => setEditing(null)} />
      </View>
    </View>
    {!trips.length && !sharedTrips.length && <View style={[s.card, { alignItems: "center", gap: 12 }]}>
      <Icon name="airplane-outline" color={C.green} size={32} />
      <Text style={s.heading}>Your next trip starts here.</Text>
      <Text style={[s.muted, { textAlign: "center" }]}>Create a trip, then assign expenses to see its total and breakdown.</Text>
    </View>}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
      {sharedTrips.sort((a, b) => (b.trip?.startDate ?? "").localeCompare(a.trip?.startDate ?? "")).map((trip) => <Pressable key={trip.id} accessibilityRole="button" accessibilityLabel={`Open shared trip ${trip.name}`}
        onPress={() => router.push({ pathname: "/trips/[id]", params: { id: trip.id } })}
        style={[s.card, { width: compact ? "100%" : "48%", padding: 20, gap: 14 }]}>
        <View style={s.between}><Icon name="people-outline" color={C.green} size={25} /><Icon name="chevron-forward" color={C.muted} size={18} /></View>
        <Text style={s.heading}>{trip.name}</Text>
        <Text style={s.muted}>{parseDate(trip.trip!.startDate).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })} – {parseDate(trip.trip!.endDate).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}</Text>
        <Text style={s.muted}>Shared · {trip.memberCount} {trip.memberCount === 1 ? "person" : "people"}</Text>
      </Pressable>)}
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
    {creatingShared && <SharedTripForm currency={ledger.currency} onClose={() => setCreatingShared(false)} onSaved={async (trip) => {
      await refresh();
      router.push({ pathname: "/trips/[id]", params: { id: trip.id } });
    }} />}
    {joining && <Sheet visible title="Join a trip" onClose={() => { if (!busy) setJoining(false); }}>
      <Field label="Invitation code" placeholder="Enter code" value={code} onChangeText={setCode} autoCapitalize="characters" maxLength={16} />
      <Text style={s.muted}>Ask the trip creator for a code. Each code lasts 10 minutes.</Text>
      {joinError ? <Text accessibilityRole="alert" style={s.error}>{joinError}</Text> : null}
      <Button title={busy ? "Joining…" : "Join trip"} disabled={busy || !code.trim()} onPress={() => void join()} />
    </Sheet>}
  </View>;
}
