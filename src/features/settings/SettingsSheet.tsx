import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { changeCurrency } from "../../domain/commands";
import { useLedger } from "../../providers/LedgerProvider";
import { C, palettes, setTheme, themeOptions, useTheme } from "../../shared/theme";
import { Button, Icon, Sheet, s } from "../../shared/ui";

export function SettingsSheet({ visible, onClose }: { visible: boolean; onClose: () => void; }) {
  const { ledger, email, demo, commit, leaveDemo, logout } = useLedger();
  const theme = useTheme();
  return <Sheet visible={visible} title="Your personal space" onClose={onClose}>
    <Text style={s.muted}>{demo
      ? "You are exploring sample data. Nothing here changes your account."
      : `Signed in as ${email}. Your entries and receipts sync through your own server.`}</Text>
    <View style={{ gap: 10 }}>
      <Text style={s.label}>Appearance</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {themeOptions.map((option) => {
          const selected = theme === option.id;
          return <Pressable key={option.id} accessibilityRole="radio" accessibilityLabel={`${option.label} theme`}
            accessibilityState={{ checked: selected }} aria-checked={selected} onPress={() => setTheme(option.id)}
            style={{ width: "47%", minWidth: 125, flexGrow: 1, borderRadius: 13, borderWidth: selected ? 2 : 1,
              borderColor: selected ? C.accent : C.line, backgroundColor: C.paper, padding: 12, gap: 9 }}>
            <View style={{ flexDirection: "row", gap: 5 }}>
              {["bg", "paper", "accent", "ink"].map((token) =>
                <View key={token} style={{ width: 17, height: 17, borderRadius: 5,
                  backgroundColor: palettes[option.id][token as "bg" | "paper" | "accent" | "ink"],
                  borderWidth: 1, borderColor: C.line }} />)}
            </View>
            <View style={s.between}>
              <Text style={{ color: C.ink, fontSize: 13, fontWeight: "600" }}>{option.label}</Text>
              {selected && <Icon name="checkmark-circle" size={18} color={C.accent} />}
            </View>
            <Text style={{ color: C.muted, fontSize: 11 }}>{option.description}</Text>
          </Pressable>;
        })}
      </View>
    </View>
    <Text style={s.label}>Account currency</Text>
    <View style={[s.row, { flexWrap: "wrap" }]}>
      {["CAD", "USD", "EUR", "GBP"].map((currency) => <Button
        key={currency} title={currency}
        tone={ledger.currency === currency ? "primary" : "quiet"}
        disabled={!!(ledger.transactions.length || ledger.recurring.length) && ledger.currency !== currency}
        onPress={async () => {
          try { await commit(changeCurrency(currency), "Currency updated"); }
          catch { /* The persistent sync banner displays save errors. */ }
        }}
      />)}
    </View>
    <Text style={s.muted}>Choose your currency before adding entries. One currency per account keeps your totals consistent.</Text>
    <Text style={s.muted}>Sync runs when the app opens, after each change, and every 15 seconds while in use. An internet connection to your server is required to save.</Text>
    <Button title={demo ? "Leave demo" : "Sign out"} tone="quiet" icon="log-out-outline" onPress={async () => {
      if (demo) leaveDemo();
      else if (!await logout()) { onClose(); return; }
      onClose();
      router.navigate("/");
    }} />
  </Sheet>;
}
