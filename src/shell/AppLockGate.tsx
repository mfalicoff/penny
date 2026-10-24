import React from "react";
import { Text, View } from "react-native";
import { useAppLock } from "../providers/AppLockProvider";
import { useTheme } from "../shared/theme";
import { Button, C, Icon, s } from "../shared/ui";

export function AppLockGate({ children }: { children: React.ReactNode }) {
  const lock = useAppLock();
  useTheme();
  if (!lock) return children;
  return <View style={{ flex: 1, backgroundColor: C.bg }}>
    {lock.admitted && <View style={{ flex: 1, display: lock.obscured ? "none" : "flex" }}
      accessibilityElementsHidden={lock.obscured} importantForAccessibility={lock.obscured ? "no-hide-descendants" : "auto"}>
      {children}
    </View>}
    {lock.obscured && <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 32, gap: 20 }}>
      <Icon name="lock-closed-outline" color={C.accent} size={44} />
      <Text style={[s.label, { fontSize: 24 }]}>{lock.loading ? "Opening Penny securely…" : "Penny is locked"}</Text>
      <Text style={[s.muted, { textAlign: "center" }]}>Unlock with Face ID, your fingerprint, or your device passcode.</Text>
      {lock.error !== "" && <Text accessibilityRole="alert" style={[s.muted, { textAlign: "center" }]}>{lock.error}</Text>}
      {lock.loading ? lock.error !== "" && <Button title="Retry" onPress={() => { void lock.retry(); }} />
        : <Button title={lock.busy ? "Authenticating…" : "Unlock Penny"} icon="finger-print-outline"
          disabled={lock.busy} onPress={() => { void lock.unlock(); }} />}
    </View>}
  </View>;
}
