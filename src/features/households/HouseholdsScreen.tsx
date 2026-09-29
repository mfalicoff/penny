import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { createHousehold, joinHousehold } from "../../data/households";
import { useLedger } from "../../providers/LedgerProvider";
import { useHouseholds } from "../../providers/HouseholdProvider";
import { Button, C, Field, Icon, Sheet, s } from "../../shared/ui";
import { useResponsive } from "../../shared/useResponsive";

export default function HouseholdsScreen() {
  const { compact } = useResponsive();
  const { ledger, demo } = useLedger();
  const { households, loading, error: loadError, refresh } = useHouseholds();
  const [mode, setMode] = useState<"create" | "join" | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!mode || saving) return;
    setSaving(true);
    setError("");
    try {
      const result = mode === "create"
        ? await createHousehold(name.trim(), ledger.currency)
        : await joinHousehold(code.trim().toUpperCase());
      if (result.household.currency !== ledger.currency) {
        setError(`This household uses ${result.household.currency}. Your personal ledger uses ${ledger.currency}.`);
        return;
      }
      await refresh();
      setMode(null);
      setName(""); setCode("");
      router.push(`/households/${result.household.id}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save household.");
    } finally { setSaving(false); }
  }

  return <View style={{ gap: 18 }}>
    <View style={compact ? { gap: 10 } : [s.card, { gap: 12 }]}>
      {!compact && <><Text style={s.heading}>Shared homes, clearer balances</Text>
        <Text style={s.muted}>Add expenses together and see each person’s share in their own spending.</Text></>}
      {!demo && <View style={[s.row, compact ? { gap: 8 } : { flexWrap: "wrap" }]}>
        <Button title="Create household" icon="add" onPress={() => { setError(""); setMode("create"); }} />
        <Button title={compact ? "Join" : "Join with code"} tone="quiet" icon="key-outline" onPress={() => { setError(""); setMode("join"); }} />
      </View>}
      {demo && <Text style={s.muted}>Sign in to create or join a household.</Text>}
    </View>
    {loadError ? <Text style={s.error}>{loadError}</Text> : null}
    {loading && !households.length ? <Text style={s.muted}>Loading households…</Text> : null}
    {households.map((household) => <Pressable key={household.id} accessibilityRole="button"
      accessibilityLabel={`Open ${household.name} household`}
      onPress={() => router.push(`/households/${household.id}`)}
      style={[s.card, s.between, { minHeight: 76, padding: compact ? 16 : 18 }]}>
      <View style={[s.row, { flex: 1 }]}><Icon name="people-outline" color={C.green} />
        <View style={{ flex: 1, gap: 4 }}><Text numberOfLines={1} style={s.heading}>{household.name}</Text>
          <Text style={s.muted}>{household.memberCount} {household.memberCount === 1 ? "member" : "members"} · {household.currency}</Text>
        </View></View><Icon name="chevron-forward" color={C.muted} />
    </Pressable>)}
    {!loading && !households.length && !loadError && <View style={{ alignItems: "center", gap: 8, padding: 28 }}>
      <Icon name="people-outline" size={28} color={C.muted} />
      <Text style={[s.muted, { textAlign: "center" }]}>No households yet</Text>
    </View>}
    {mode && <Sheet visible title={mode === "create" ? "Create a household" : "Join a household"} onClose={() => setMode(null)}
      footer={<><Text style={s.muted}>{mode === "create" ? `Expenses will use ${ledger.currency}, the currency of your personal ledger.` : "Ask the creator for a code. Each code lasts 10 minutes."}</Text>
        {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
        <Button title={saving ? "Saving…" : mode === "create" ? "Create household" : "Join household"} disabled={saving || !(mode === "create" ? name.trim() : code.trim())} onPress={() => void submit()} /></> }>
      {mode === "create" ? <Field label="Household name" placeholder="Our home" value={name} onChangeText={setName} maxLength={80} />
        : <Field label="Invitation code" placeholder="Enter code" value={code} onChangeText={setCode} autoCapitalize="characters" maxLength={16} />}
    </Sheet>}
  </View>;
}
