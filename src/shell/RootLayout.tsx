import { isOidcCallback } from "../data/oidc";
import { Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Auth } from "../features/auth/AuthScreen";
import { LedgerProvider, useLedger } from "../providers/LedgerProvider";
import { WorkspaceProvider } from "../providers/WorkspaceProvider";
import { HouseholdProvider } from "../providers/HouseholdProvider";
import { ThemeProvider } from "../shared/theme";
import { C, Icon, s } from "../shared/ui";
import { AppShell } from "./AppShell";
import { WidgetClear } from "../widgets/WidgetClear";

function SessionGate() {
  const { checking, email, demo, sessionKey, login, openDemo } = useLedger();
  if (checking) return <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: 18, backgroundColor: C.bg }}>
    <Icon name="leaf-outline" color={C.accent} size={40} />
    <Text style={s.muted}>Making a little room for clarity…</Text>
  </View>;
  if (!email && !demo) return <><WidgetClear /><Auth onReady={login} onDemo={openDemo} /></>;
  return <WorkspaceProvider key={sessionKey}><HouseholdProvider><AppShell /></HouseholdProvider></WorkspaceProvider>;
}

export default function RootLayout() {
  if (isOidcCallback()) return <View style={{ flex: 1, justifyContent: "center", padding: 24 }}><Text>Completing sign-in… You can close this window and return to Penny.</Text></View>;
  return <ThemeProvider><SafeAreaProvider><LedgerProvider><SessionGate /></LedgerProvider></SafeAreaProvider></ThemeProvider>;
}
