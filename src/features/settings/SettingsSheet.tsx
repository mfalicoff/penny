import { router } from "expo-router";
import { Text, View } from "react-native";
import { changeCurrency } from "../../domain/commands";
import { useLedger } from "../../providers/LedgerProvider";
import { Button, Sheet, s } from "../../shared/ui";

export function SettingsSheet({ visible, onClose }: { visible: boolean; onClose: () => void; }) {
  const { ledger, email, demo, commit, leaveDemo, logout } = useLedger();
  return <Sheet visible={visible} title="Your personal space" onClose={onClose}>
    <Text style={s.muted}>{demo
      ? "You are exploring sample data. Nothing here changes your account."
      : `Signed in as ${email}. Your entries and receipts sync through your own server.`}</Text>
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
