import { useRef, useState } from "react";
import { Platform, Text, View } from "react-native";
import { probePennyServer, type PennyServer } from "../../data/serverConnection";
import { useServerConnection } from "../../providers/ServerConnectionProvider";
import { Button, Field, s } from "../../shared/ui";

/** Editing is only offered at the signed-out gate, never over an active workspace. */
export function ServerConnection({ editable = false, disabled = false, onBusy }: {
  editable?: boolean; disabled?: boolean; onBusy?: (busy: boolean) => void;
}) {
  const connection = useServerConnection();
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(connection?.url || "");
  const [verified, setVerified] = useState<PennyServer | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  if (Platform.OS === "web" || !connection) return null;

  async function check() {
    if (running.current || disabled) return;
    running.current = true;
    setBusy(true);
    onBusy?.(true);
    setError("");
    setVerified(null);
    try { setVerified(await probePennyServer(input)); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not check this server."); }
    finally { running.current = false; setBusy(false); onBusy?.(false); }
  }
  async function save() {
    if (!verified || !connection || running.current || disabled) return;
    running.current = true;
    setBusy(true);
    onBusy?.(true);
    setError("");
    try {
      await connection.selectServer(verified);
      setEditing(false);
    } catch { setError("Could not save the server on this device. Your previous server is unchanged."); }
    finally { running.current = false; setBusy(false); onBusy?.(false); }
  }
  return <View style={{ gap: 12 }}>
    <Text style={s.label}>Penny server</Text>
    <Text selectable style={s.muted}>{connection.url}</Text>
    {connection.version ? <Text style={s.muted}>Penny {connection.version}</Text> : null}
    {!editable ? <Text style={s.muted}>Saved on this device. To change servers, sync your entries and sign out first.</Text> :
      !editing ? <Button title="Change server" tone="quiet" disabled={disabled} onPress={() => {
        setInput(connection.url); setVerified(null); setError(""); setEditing(true);
      }} /> : <>
        <Field testID="penny-server-url" label="Server URL" value={input} onChangeText={(value) => { setInput(value); setVerified(null); setError(""); }}
          keyboardType="url" autoCapitalize="none" autoCorrect={false} editable={!busy && !disabled}
          placeholder="https://penny.example.com" />
        <Text style={s.muted}>Enter the server’s base URL, without /api. Use HTTPS to protect your account. This setting only affects this device.</Text>
        {input.trim().toLowerCase().startsWith("http:") ? <Text style={s.error}>HTTP is unencrypted and may be blocked by your device. Prefer HTTPS outside a trusted local network.</Text> : null}
        {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
        {verified ? <>
          <Text accessibilityLiveRegion="polite" style={s.muted}>Penny {verified.version} · Server verified</Text>
          <Button title={busy ? "Saving…" : "Use this server"} disabled={busy || disabled} onPress={() => { void save(); }} />
        </> : <Button title={busy ? "Checking server…" : "Check server"} disabled={busy || disabled || !input.trim()} onPress={() => { void check(); }} />}
        <Button title="Cancel" tone="quiet" disabled={busy || disabled} onPress={() => setEditing(false)} />
      </>}
  </View>;
}
