import { Slot, router, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { EntryDialog } from "../features/entries/EntryDialog";
import { SettingsSheet } from "../features/settings/SettingsSheet";
import { useLedger } from "../providers/LedgerProvider";
import { useWorkspace } from "../providers/WorkspaceProvider";
import { useTheme } from "../shared/theme";
import { Button, C, Icon, IconButton, Sheet, s } from "../shared/ui";
import { useResponsive } from "../shared/useResponsive";
import { SaveToast } from "./SaveToast";
import { WidgetSync } from "../widgets/WidgetSync";
type Tab = "Overview" | "Transactions" | "Households" | "Trips" | "Recurring" | "Categories" | "Accounts";
const navigation: { tab: Tab; icon: string; mobileLabel: string }[] = [
  { tab: "Overview", icon: "grid-outline", mobileLabel: "Home" },
  { tab: "Transactions", icon: "list-outline", mobileLabel: "Entries" },
  { tab: "Households", icon: "people-outline", mobileLabel: "Shared" },
  { tab: "Trips", icon: "airplane-outline", mobileLabel: "Trips" },
  { tab: "Recurring", icon: "repeat-outline", mobileLabel: "Repeat" },
  { tab: "Categories", icon: "pricetags-outline", mobileLabel: "Tags" },
  { tab: "Accounts", icon: "wallet-outline", mobileLabel: "Wallet" },
];
export function AppShell() {
  const theme = useTheme();
  const a = makeStyles();
  const { compact, desktop } = useResponsive();
  const { height } = useWindowDimensions();
  const shortSidebar = height < 850;
  const veryShortSidebar = height < 600;
  const { email, demo, leaveDemo, syncing, syncError, sync, toast, toastKind, toastSequence } = useLedger();
  const { setForm } = useWorkspace();
  const [settings, setSettings] = React.useState(false);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const pathname = usePathname();
  const nestedMobileScreen = compact && (pathname.startsWith("/households/") || pathname.startsWith("/trips/"));
  const tab: Tab = pathname === "/transactions" ? "Transactions" : pathname.startsWith("/households") ? "Households" : pathname.startsWith("/trips") ? "Trips" : pathname === "/accounts" ? "Accounts" : pathname === "/recurring" ? "Recurring" : pathname === "/categories" ? "Categories" : "Overview";
  const setTab = (value: Tab) => router.navigate(({ Overview: "/", Transactions: "/transactions", Households: "/households", Trips: "/trips", Recurring: "/recurring", Categories: "/categories", Accounts: "/accounts" } as const)[value]);
  const nav = (mobile = false) => (
    <View style={mobile ? a.mobileNav : { gap: shortSidebar ? 4 : 8 }}>
      {(mobile ? navigation.slice(0, 4) : navigation).map((item) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={item.tab}
          accessibilityState={{ selected: tab === item.tab }}
          onPress={() => setTab(item.tab)}
          key={item.tab}
          style={[
            mobile ? a.mobileNavItem : a.navItem,
            !mobile && shortSidebar && { paddingVertical: veryShortSidebar ? 6 : 10 },
            tab === item.tab && { backgroundColor: C.pale },
          ]}
        >
          <Icon
            name={item.icon}
            size={mobile ? 21 : 19}
            color={tab === item.tab ? C.ink : C.muted}
          />
          <Text
            numberOfLines={1}
            style={{
              color: tab === item.tab ? C.ink : C.muted,
              fontSize: mobile ? 11 : 13,
              fontWeight: tab === item.tab ? "600" : "400",
            }}
          >
            {mobile ? item.mobileLabel : item.tab}
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
      {mobile && <Pressable accessibilityRole="button" accessibilityLabel="More sections"
        accessibilityState={{ selected: ["Recurring", "Categories", "Accounts"].includes(tab) }}
        onPress={() => setMoreOpen(true)} style={[a.mobileNavItem, ["Recurring", "Categories", "Accounts"].includes(tab) && { backgroundColor: C.pale }]}>
        <Icon name="ellipsis-horizontal" size={21} color={["Recurring", "Categories", "Accounts"].includes(tab) ? C.ink : C.muted} />
        <Text style={{ color: ["Recurring", "Categories", "Accounts"].includes(tab) ? C.ink : C.muted, fontSize: 11, fontWeight: "600" }}>More</Text>
      </Pressable>}
    </View>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <WidgetSync />
      <StatusBar style={theme === "light" ? "dark" : "light"} />
      <View style={{ flex: 1, flexDirection: "row" }}>
        {desktop && (
          <View style={a.sidebar}>
            <View style={[s.row, { paddingHorizontal: 12, marginBottom: shortSidebar ? 22 : 52 }]}>
              <View style={a.logo}>
                <Icon name="leaf-outline" color="white" size={22} />
              </View>
              <Text style={a.brand}>
                penny<Text style={{ color: C.accent }}>.</Text>
              </Text>
            </View>
            {!veryShortSidebar && <Text style={a.navLabel}>YOUR EVERYDAY</Text>}
            {nav()}
            <View style={{ flex: 1 }} />
            {!shortSidebar && <View style={a.sideNote}>
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
            </View>}
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
              padding: compact ? 16 : 40,
              paddingTop: compact ? 16 : 36,
              gap: compact ? 16 : 26,
              maxWidth: 1320,
              width: "100%",
              alignSelf: "center",
              paddingBottom: compact ? 24 : 44,
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
            {!nestedMobileScreen && <View style={[s.between, compact && { alignItems: "flex-start" }]}>
              <View style={{ gap: compact ? 0 : 8, flex: 1 }}>
                {!compact && <Text style={a.eyebrow}>
                  {tab === "Overview"
                    ? "A LITTLE MORE CLARITY"
                    : tab === "Transactions"
                      ? "EVERY ENTRY, IN VIEW"
                    : tab === "Trips"
                      ? "MEMORIES, WITH A CLEARER TOTAL"
                    : tab === "Households"
                      ? "SHARE THE EVERYDAY"
                    : tab === "Recurring"
                      ? "SET IT. REMEMBER LESS."
                      : "A PLACE FOR EVERYTHING"}
                </Text>}
                <Text style={[a.pageTitle, compact && { fontSize: 28 }]}>
                  {tab === "Overview"
                    ? compact ? "Overview" : "Your money, at a glance."
                    : tab === "Transactions"
                      ? compact ? "Transactions" : "Your transactions."
                    : tab === "Trips"
                    ? compact ? "Trips" : "Your trips."
                    : tab === "Households"
                      ? compact ? "Households" : "Your households."
                    : tab === "Recurring"
                      ? compact ? "Recurring" : "On repeat."
                      : tab === "Accounts" ? compact ? "Accounts" : "Your accounts." : compact ? "Categories" : "Keep it organized."}
                </Text>
                {!compact && <Text style={s.muted}>
                  {tab === "Overview"
                    ? "The everyday ins and outs, all in one place."
                    : tab === "Transactions"
                      ? "Browse your income, expenses, and investments by month or year."
                    : tab === "Trips"
                      ? "See the expenses behind each journey."
                    : tab === "Households"
                      ? "Shared expenses and monthly reimbursements, together."
                    : tab === "Recurring"
                      ? "Your regular expenses, income, and investments, taken care of."
                      : tab === "Accounts" ? "Bank, card, or cash. Give every entry a home." : "Categories that make sense for your everyday."}
                </Text>}
              </View>
              {!compact && tab !== "Categories" && tab !== "Accounts" && tab !== "Households" && (
                <Button
                  title="Add entry"
                  icon="add"
                  onPress={() =>
                    setForm({})
                  }
                />
              )}
            </View>}
            {syncError !== "" && (
              <View
                style={[
                  s.between,
                  { backgroundColor: C.dangerBg, borderRadius: 12, padding: 14 },
                ]}
              >
                <Text style={{ color: C.danger, fontSize: 12, flex: 1 }}>
                  {syncError}
                </Text>
                <Button title="Retry" tone="quiet" onPress={sync} />
              </View>
            )}
            {compact && !nestedMobileScreen && tab !== "Categories" && tab !== "Accounts" && tab !== "Households" && (
              <Button
                title="Add entry"
                icon="add"
                onPress={() =>
                  setForm({})
                }
              />
            )}
            <Slot />
            {!compact && <View style={s.between}>
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
              <Text style={{ color: C.subtle, fontSize: 10 }}>
                One little entry at a time.
              </Text>
            </View>}
          </ScrollView>
          {!desktop && nav(true)}
        </View>
      </View>
      {toast !== "" && (
        <SaveToast key={toastSequence} message={toast} kind={toastKind} />
      )}
      <EntryDialog />
      <SettingsSheet visible={settings} onClose={() => setSettings(false)} />
      {moreOpen && <Sheet visible title="More" onClose={() => setMoreOpen(false)}>
        {navigation.slice(4).map((item) => <Pressable key={item.tab} accessibilityRole="button" accessibilityLabel={item.tab}
          onPress={() => { setMoreOpen(false); setTab(item.tab); }}
          style={[s.row, { minHeight: 52, borderBottomWidth: 1, borderColor: C.line }]}>
          <Icon name={item.icon} color={C.ink} />
          <Text style={[s.label, { flex: 1, fontSize: 15 }]}>{item.tab}</Text>
          <Icon name="chevron-forward" size={17} color={C.muted} />
        </Pressable>)}
      </Sheet>}
    </SafeAreaView>
  );
}

const makeStyles = () => StyleSheet.create({
  sidebar: {
    width: 224,
    backgroundColor: C.chrome,
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
    color: C.subtle,
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
    backgroundColor: C.soft,
    borderRadius: 16,
    padding: 18,
    gap: 12,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 12,
    backgroundColor: C.avatar,
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
    backgroundColor: C.chrome,
  },
  mobileNav: {
    flexDirection: "row",
    justifyContent: "space-around",
    backgroundColor: C.chrome,
    padding: 10,
    borderTopWidth: 1,
    borderColor: C.line,
  },
  mobileNavItem: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    gap: 5,
    paddingVertical: 9,
    paddingHorizontal: 4,
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
    color: C.subtle,
    letterSpacing: 1.8,
  },
  demoBanner: {
    backgroundColor: C.orangeBg,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 11,
  },
});
