import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { oidcConfiguration, prepareOidc, signInOidc, type OidcAttempt } from "../../data/oidc";
import { Button, s } from "../../shared/ui";

export function OidcButton({ onReady, busy, onBusy }: { onReady: (email: string) => void; busy: boolean; onBusy: (busy: boolean) => void }) {
  const [config, setConfig] = useState<{ enabled: boolean; label?: string }>();
  const [attempt, setAttempt] = useState<OidcAttempt>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const mounted = useRef(false);
  const running = useRef(false);
  useEffect(() => {
    mounted.current = true;
    oidcConfiguration().then(setConfig).catch(() => setError("Could not load single sign-on. Try again."));
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!config?.enabled) return;
    let active = true;
    prepareOidc().then((value) => { if (active) setAttempt(value); }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [config]);
  async function retry() {
    setError("");
    setLoading(true);
    try { setConfig({ ...await oidcConfiguration() }); }
    catch { setError("Could not load single sign-on. Try again."); }
    finally { setLoading(false); }
  }
  async function signIn() {
    if (!attempt || busy || running.current) return;
    running.current = true;
    onBusy(true);
    setError("");
    let completed = false;
    try {
      const email = await signInOidc(attempt);
      if (email && mounted.current) { completed = true; onReady(email); }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : "Could not sign in.");
    } finally {
      running.current = false;
      if (mounted.current) {
        onBusy(false);
        if (!completed) { setAttempt(undefined); setConfig((value) => value ? { ...value } : value); }
      }
    }
  }
  if (!config?.enabled && !error) return null;
  return <View style={{ gap: 12 }}>
    {error ? <Text style={s.error}>{error}</Text> : null}
    {error && !attempt ? <Button title="Retry single sign-on" onPress={retry} disabled={busy || loading} tone="quiet" /> :
      <Button title={`Continue with ${config?.label || "single sign-on"}`} onPress={signIn} disabled={busy || !attempt} tone="quiet" />}
  </View>;
}
