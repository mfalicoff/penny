import { Slot, router, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { EntryDialog } from "../features/entries/EntryDialog";
import { SettingsSheet } from "../features/settings/SettingsSheet";
import { useLedger } from "../providers/LedgerProvider";
import { useWorkspace } from "../providers/WorkspaceProvider";
import { Button, C, Icon, IconButton, s } from "../shared/ui";
import { useResponsive } from "../shared/useResponsive";
type Tab = "Overview" | "Recurring" | "Categories";
const navigation: { tab: Tab; icon: string; }[] = [
  { tab: "Overview", icon: "grid-outline" },
  { tab: "Recurring", icon: "repeat-outline" },
  { tab: "Categories", icon: "pricetags-outline" },
];
export function AppShell() {
  const { compact, desktop } = useResponsive();
  const { email, demo, leaveDemo, syncing, syncError, sync, toast } = useLedger();
  const { setForm } = useWorkspace();
  const [settings, setSettings] = React.useState(false);
  const pathname = usePathname();
  const tab: Tab = pathname === "/recurring" ? "Recurring" : pathname === "/categories" ? "Categories" : "Overview";
  const setTab = (value: Tab) => router.navigate(({ Overview: "/", Recurring: "/recurring", Categories: "/categories" } as const)[value]);
  const nav = (mobile = false) => (
    <View style={mobile ? a.mobileNav : { gap: 8 }}>
      {navigation.map((item) => (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: tab === item.tab }}
          onPress={() => setTab(item.tab)}
          key={item.tab}
          style={[
            mobile ? a.mobileNavItem : a.navItem,
            tab === item.tab && { backgroundColor: C.pale },
          ]}
        >
          <Icon
            name={item.icon}
            size={mobile ? 21 : 19}
            color={tab === item.tab ? C.ink : C.muted}
          />
          <Text
            style={{
              color: tab === item.tab ? C.ink : C.muted,
              fontSize: mobile ? 10 : 13,
              fontWeight: tab === item.tab ? "600" : "400",
            }}
          >
            {item.tab}
          </Text>
          {!mobile && tab === item.tab && (
            <View
              style={{
                width: 5,
                height: 5,
                borderRadius: 5,
                marginLeft: "auto",
                backgroundColor: C.green,
              }}
            />
          )}
        </Pressable>
      ))}
    </View>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar style="dark" />
      <View style={{ flex: 1, flexDirection: "row" }}>
        {desktop && (
          <View style={a.sidebar}>
            <View style={[s.row, { paddingHorizontal: 12, marginBottom: 52 }]}>
              <View style={a.logo}>
                <Icon name="leaf-outline" color="white" size={22} />
              </View>
              <Text style={a.brand}>
                penny<Text style={{ color: C.accent }}>.</Text>
              </Text>
            </View>
            <Text style={a.navLabel}>YOUR EVERYDAY</Text>
            {nav()}
            <View style={{ flex: 1 }} />
            <View style={a.sideNote}>
              <Icon name="sunny-outline" color={C.green} size={27} />
              <Text
                style={{
                  color: C.ink,
                  fontSize: 15,
                  lineHeight: 23,
                  fontWeight: "500",
                }}
              >
                Little entries.{"\n"}A clearer picture.
              </Text>
              <Text style={[s.muted, { fontSize: 11, lineHeight: 18 }]}>
                Make a little space to see where your money goes.
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setSettings(true)}
              style={[s.row, { padding: 10, paddingTop: 24 }]}
            >
              <View style={a.avatar}>
                <Text style={{ color: C.ink, fontWeight: "600" }}>
                  {demo ? "D" : email?.[0].toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{ color: C.ink, fontWeight: "500", fontSize: 12 }}
                  numberOfLines={1}
                >
                  {demo ? "Demo account" : email}
                </Text>
                <Text style={{ color: C.muted, fontSize: 10, marginTop: 4 }}>
                  Personal space
                </Text>
              </View>
              <Icon name="settings-outline" size={17} color={C.muted} />
            </Pressable>
          </View>
        )}
        <View style={{ flex: 1 }}>
          {!desktop && (
            <View style={a.mobileHeader}>
              <View style={s.row}>
                <View
                  style={[a.logo, { width: 30, height: 30, borderRadius: 10 }]}
                >
                  <Icon name="leaf-outline" color="white" size={18} />
                </View>
                <Text style={[a.brand, { fontSize: 24 }]}>penny.</Text>
              </View>
              <IconButton
                icon="settings-outline"
                label="Account settings"
                onPress={() => setSettings(true)}
              />
            </View>
          )}
          <ScrollView
            contentContainerStyle={{
              padding: compact ? 20 : 40,
              paddingTop: compact ? 20 : 36,
              gap: 26,
              maxWidth: 1320,
              width: "100%",
              alignSelf: "center",
              paddingBottom: 44,
            }}
          >
            {demo && (
              <View
                style={[
                  s.between,
                  a.demoBanner,
                  compact && { flexWrap: "wrap" },
                ]}
              >
                <View style={s.row}>
                  <Icon name="sparkles-outline" color={C.accent} size={17} />
                  <Text style={{ color: C.ink, fontSize: 12 }}>
                    Sample data · Have a look around.
                  </Text>
                </View>
                <Pressable accessibilityRole="button" onPress={() => { leaveDemo(); setTab("Overview"); }}>
                  <Text
                    style={{ color: C.accent, fontWeight: "600", fontSize: 12 }}
                  >
                    Start my own tracker →
                  </Text>
                </Pressable>
              </View>
            )}
            <View style={[s.between, compact && { alignItems: "flex-start" }]}>
              <View style={{ gap: 8, flex: 1 }}>
                <Text style={a.eyebrow}>
                  {tab === "Overview"
                    ? "A LITTLE MORE CLARITY"
                    : tab === "Recurring"
                      ? "SET IT. REMEMBER LESS."
                      : "A PLACE FOR EVERYTHING"}
                </Text>
                <Text style={[a.pageTitle, compact && { fontSize: 28 }]}>
                  {tab === "Overview"
                    ? "Your money, at a glance."
                    : tab === "Recurring"
                      ? "On repeat."
                      : "Keep it organized."}
                </Text>
                <Text style={s.muted}>
                  {tab === "Overview"
                    ? "The everyday ins and outs, all in one place."
                    : tab === "Recurring"
                      ? "Your regular expenses and income, taken care of."
                      : "Categories that make sense for your everyday."}
                </Text>
              </View>
              {!compact && tab !== "Categories" && (
                <Button
                  title="Add entry"
                  icon="add"
                  onPress={() =>
                    setForm({})
                  }
                />
              )}
            </View>
            {syncError !== "" && (
              <View
                style={[
                  s.between,
                  { backgroundColor: "#FFF1ED", borderRadius: 12, padding: 14 },
                ]}
              >
                <Text style={{ color: "#B45343", fontSize: 12, flex: 1 }}>
                  {syncError}
                </Text>
                <Button title="Retry" tone="quiet" onPress={sync} />
              </View>
            )}
            {compact && tab !== "Categories" && (
              <Button
                title="Add entry"
                icon="add"
                onPress={() =>
                  setForm({})
                }
              />
            )}
            <Slot />
            <View style={s.between}>
              <View style={[s.row, { gap: 6 }]}>
                <View
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: 5,
                    backgroundColor: syncError ? C.accent : C.green,
                  }}
                />
                <Text style={{ color: C.muted, fontSize: 10 }}>
                  {demo
                    ? "Demo · Changes are temporary"
                    : syncing
                      ? "Syncing with your server…"
                      : syncError
                        ? "Not synced · Retry to reconnect"
                        : "Synced with your server"}
                </Text>
              </View>
              <Text style={{ color: "#A3ADA4", fontSize: 10 }}>
                One little entry at a time.
              </Text>
            </View>
          </ScrollView>
          {!desktop && nav(true)}
        </View>
      </View>
      {toast !== "" && (
        <View accessibilityRole="alert" style={a.toast}>
          <Icon name="checkmark-circle" color="#B4D7B6" size={18} />
          <Text style={{ color: "white", fontSize: 13 }}>{toast}</Text>
        </View>
      )}
      <EntryDialog />
      <SettingsSheet visible={settings} onClose={() => setSettings(false)} />
    </SafeAreaView>
  );
}

const a = StyleSheet.create({
  sidebar: {
    width: 224,
    backgroundColor: "#FEFFFC",
    borderRightWidth: 1,
    borderColor: C.line,
    padding: 23,
    paddingTop: 39,
  },
  logo: {
    width: 36,
    height: 36,
    backgroundColor: C.accent,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  brand: { color: C.ink, fontSize: 29, fontWeight: "600", letterSpacing: -1.5 },
  navLabel: {
    fontSize: 9,
    letterSpacing: 1.6,
    fontWeight: "600",
    color: "#A4AEA6",
    marginBottom: 18,
    marginLeft: 12,
  },
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    paddingVertical: 15,
    paddingHorizontal: 13,
    borderRadius: 12,
  },
  sideNote: {
    backgroundColor: "#F5F7F0",
    borderRadius: 16,
    padding: 18,
    gap: 12,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 12,
    backgroundColor: "#EAF0E5",
    alignItems: "center",
    justifyContent: "center",
  },
  mobileHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: C.line,
    backgroundColor: "#FEFFFC",
  },
  mobileNav: {
    flexDirection: "row",
    justifyContent: "space-around",
    backgroundColor: "#FEFFFC",
    padding: 10,
    borderTopWidth: 1,
    borderColor: C.line,
  },
  mobileNavItem: {
    alignItems: "center",
    gap: 5,
    paddingVertical: 9,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  pageTitle: {
    fontSize: 34,
    fontWeight: "500",
    color: C.ink,
    letterSpacing: -1.2,
  },
  eyebrow: {
    fontSize: 9,
    fontWeight: "600",
    color: "#8A988A",
    letterSpacing: 1.8,
  },
  demoBanner: {
    backgroundColor: "#FBEEE6",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 11,
  },
  toast: {
    position: "absolute",
    bottom: 86,
    alignSelf: "center",
    backgroundColor: C.ink,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 14,
    flexDirection: "row",
    gap: 9,
    alignItems: "center",
    boxShadow: "0px 8px 30px #24362A20",
  },
});
