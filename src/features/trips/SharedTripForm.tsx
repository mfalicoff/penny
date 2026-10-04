import { useState } from "react";
import { Text, View } from "react-native";
import { createSharedTrip, updateSharedTrip, type Household } from "../../data/households";
import { dateKey, validDate } from "../../domain/ledger";
import { Button, Field, s, Sheet } from "../../shared/ui";
import { DateField } from "../../shared/ui/DateField";

export function SharedTripForm({ currency, trip, initial, onSaved, onClose }: {
  currency: string;
  trip?: Household;
  initial?: { name: string; startDate: string; endDate: string };
  onSaved: (trip: Household) => Promise<void> | void;
  onClose: () => void;
}) {
  const [name, setName] = useState(trip?.name ?? initial?.name ?? "");
  const [startDate, setStartDate] = useState(trip?.trip?.startDate ?? initial?.startDate ?? dateKey());
  const [endDate, setEndDate] = useState(trip?.trip?.endDate ?? initial?.endDate ?? dateKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    if (busy) return;
    if (!name.trim() || !validDate(startDate) || !validDate(endDate) || endDate < startDate) {
      setError("Give the trip a name and valid dates, with the end on or after the start.");
      return;
    }
    setBusy(true); setError("");
    try {
      const result = trip
        ? await updateSharedTrip(trip.id, name.trim(), startDate, endDate)
        : await createSharedTrip(name.trim(), currency, startDate, endDate);
      await onSaved(result.household);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this trip.");
    } finally { setBusy(false); }
  }
  return <Sheet visible title={trip ? "Edit shared trip" : "Create shared trip"} onClose={() => { if (!busy) onClose(); }}>
    <View style={{ gap: 20, pointerEvents: busy ? "none" : "auto" }}>
      <Field label="Trip name" placeholder="e.g. Summer in Montréal" value={name} onChangeText={setName} maxLength={80} />
      <DateField label="Start date" value={startDate} onChange={setStartDate} />
      <DateField label="End date" value={endDate} onChange={setEndDate} />
      <Text style={s.muted}>Invite people after creating the trip. Everyone can add expenses and see their share.</Text>
      {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
      <Button title={busy ? "Saving…" : trip ? "Save changes" : "Create shared trip"} disabled={busy} onPress={() => void save()} />
    </View>
  </Sheet>;
}
