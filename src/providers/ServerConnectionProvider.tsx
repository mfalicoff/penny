import { createContext, Fragment, useContext, useEffect, useState, type PropsWithChildren } from "react";
import { Platform, Text, View } from "react-native";
import { readServerConfiguration, saveServerConfiguration, type PennyServer, type ServerConfiguration } from "../data/serverConnection";
import { Button, C, s } from "../shared/ui";

type Connection = ServerConfiguration & { selectServer: (server: PennyServer) => Promise<void> };
const ServerConnectionContext = createContext<Connection | null>(null);
export const useServerConnection = () => useContext(ServerConnectionContext);

export function ServerConnectionProvider({ children }: PropsWithChildren) {
  const [configuration, setConfiguration] = useState<ServerConfiguration | null>(null);
  const [error, setError] = useState("");
  async function load() {
    try { setConfiguration(await readServerConfiguration()); setError(""); }
    catch { setError("Could not load this device's server setting. Your saved data has not been changed."); }
  }
  useEffect(() => {
    if (Platform.OS === "web") return;
    let active = true;
    void readServerConfiguration().then((value) => {
      if (active) setConfiguration(value);
    }).catch(() => {
      if (active) setError("Could not load this device's server setting. Your saved data has not been changed.");
    });
    return () => { active = false; };
  }, []);
  if (Platform.OS === "web") return children;
  if (!configuration) return <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: "center", padding: 24, gap: 16 }}>
    <Text style={s.muted}>{error || "Loading your server…"}</Text>
    {error ? <Button title="Retry" onPress={load} /> : null}
  </View>;
  async function selectServer(server: PennyServer) {
    const next = await saveServerConfiguration(server);
    setConfiguration(next);
  }
  return <ServerConnectionContext.Provider value={{ ...configuration, selectServer }}>
    {/* Discard auth drafts, prepared OIDC transactions, and all workspace state on a switch. */}
    <Fragment key={configuration.url}>{children}</Fragment>
  </ServerConnectionContext.Provider>;
}
