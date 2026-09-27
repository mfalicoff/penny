import { OidcButton } from "./OidcButton";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { signIn } from "../../data/api";
import { Button, C, Field, Icon, s } from "../../shared/ui";
export function Auth({
  onReady,
  onDemo,
}: {
  onReady: (email: string) => void;
  onDemo: () => void;
}) {
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const address = await signIn(email.trim(), password, register);
      onReady(address);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          alignItems: "center",
          padding: 24,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ maxWidth: 410, width: "100%", gap: 26 }}>
          <View style={{ alignItems: "center", gap: 16 }}>
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 21,
                backgroundColor: C.accent,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="leaf-outline" size={32} color="white" />
            </View>
            <Text
              style={{
                fontSize: 40,
                fontWeight: "600",
                color: C.ink,
                letterSpacing: -2,
              }}
            >
              penny<Text style={{ color: C.accent }}>.</Text>
            </Text>
            <Text style={{ fontSize: 17, color: C.muted }}>
              A little clarity for your everyday money.
            </Text>
          </View>
          <View style={[s.card, { gap: 20, marginTop: 12 }]}>
            <Text style={s.heading}>
              {register ? "Make yourself at home." : "Welcome back."}
            </Text>
            <OidcButton onReady={onReady} busy={busy} onBusy={setBusy} />
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              placeholder="you@example.com"
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete={register ? "new-password" : "current-password"}
              placeholder={
                register ? "At least 10 characters" : "Your password"
              }
              onSubmitEditing={submit}
            />
            {error ? <Text style={s.error}>{error}</Text> : null}
            <Button
              title={
                busy ? "One moment…" : register ? "Create account" : "Sign in"
              }
              onPress={submit}
              disabled={busy}
            />
            <Pressable
              disabled={busy}
              accessibilityRole="button"
              onPress={() => {
                setRegister(!register);
                setError("");
              }}
            >
              <Text
                style={{ textAlign: "center", color: C.accent, fontSize: 13 }}
              >
                {register
                  ? "Already have an account? Sign in"
                  : "New here? Create an account"}
              </Text>
            </Pressable>
          </View>
          <Button
            title="Take a look around with sample data"
            tone="quiet"
            onPress={onDemo}
            disabled={busy}
          />
          <View style={[s.row, { justifyContent: "center" }]}>
            <Icon name="server-outline" size={14} color={C.muted} />
            <Text style={{ color: C.muted, fontSize: 12 }}>
              Your devices. Your server. Your money.
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
