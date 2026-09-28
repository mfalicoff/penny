import { useState } from "react";
import { Text, View } from "react-native";
import { saveTrip, type LedgerChange } from "../../domain/commands";
import { dateKey, uid, type Trip } from "../../domain/ledger";
import { DateField } from "../../shared/ui/DateField";
import { Button, Field, s, Sheet } from "../../shared/ui";

export function TripForm({ trip, used = false, commit, onClose, onRemoved }: {
  trip?: Trip;
  used?: boolean;
  commit: (change: LedgerChange, message: string) => Promise<void>;
  onClose: () => void;
  onRemoved?: () => void;
}) {
  const [name, setName] = useState(trip?.name ?? "");
  const [startDate, setStartDate] = useState(trip?.startDate ?? dateKey());
  const [endDate, setEndDate] = useState(trip?.endDate ?? dateKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(remove = false) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const item = { id: trip?.id ?? uid(), name, startDate, endDate };
      await commit(saveTrip(item, trip, remove), remove ? "Trip removed" : "Trip saved");
      onClose();
      if (remove) onRemoved?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this trip.");
    } finally {
      setBusy(false);
    }
  }
  return <Sheet visible title={trip ? "Edit trip" : "Create trip"} onClose={() => { if (!busy) onClose(); }}>
    <View style={{ gap: 20, pointerEvents: busy ? "none" : "auto" }}>
      <Field label="Trip name" placeholder="e.g. Summer in Montréal" value={name} onChangeText={setName} maxLength={80} />
      <DateField label="Start date" value={startDate} onChange={setStartDate} />
      <DateField label="End date" value={endDate} onChange={setEndDate} />
      <Text style={s.muted}>Expenses before or after these dates can still be assigned to this trip.</Text>
      {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
      <Button title={busy ? "Saving…" : trip ? "Save changes" : "Create trip"} disabled={busy} onPress={() => save()} />
      {trip && <>
        {used && <Text style={s.muted}>Reassign this trip’s expenses before deleting it.</Text>}
        <Button title={used ? "Trip has expenses" : "Delete trip"} tone="danger" disabled={used || busy} onPress={() => save(true)} />
      </>}
    </View>
  </Sheet>;
}
