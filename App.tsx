import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { Slot, router, usePathname } from "expo-router";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  ApiError,
  fetchLedger,
  mutateLedger,
  signOut,
  whoAmI,
} from "./src/api";
import { Auth } from "./src/Auth";
import { EntryForm } from "./src/EntryForm";
import { MoneyFlowChart } from "./src/MoneyFlowChart";
import {
  dateKey,
  demoLedger,
  emptyLedger,
  materialize,
  nextOccurrence,
  palette,
  parseDate,
  totals,
  uid,
  type Category,
  type Ledger,
  type Recurring,
  type Transaction,
} from "./src/model";
import { Button, C, Field, Icon, IconButton, Sheet, Tag, s } from "./src/ui";

type Tab = "Overview" | "Recurring" | "Categories";
const navigation: { tab: Tab; icon: string }[] = [
  { tab: "Overview", icon: "grid-outline" },
  { tab: "Recurring", icon: "repeat-outline" },
  { tab: "Categories", icon: "pricetags-outline" },
];
const currencyFormat = (value: number, currency: string) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value / 100);

function Penny() {
  const { width } = useWindowDimensions();
  const desktop = width >= 1000;
  const compact = width < 600;
  const [email, setEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [demo, setDemo] = useState(false);
  const [ledger, setLedger] = useState<Ledger>(emptyLedger());
  const ledgerRef = useRef(ledger);
  ledgerRef.current = ledger;
  const pathname = usePathname();
  const tab: Tab = pathname === "/recurring" ? "Recurring" : pathname === "/categories" ? "Categories" : "Overview";
  const setTab = (value: Tab) => router.navigate(({ Overview: "/", Recurring: "/recurring", Categories: "/categories" } as const)[value]);
  const [month, setMonth] = useState(dateKey().slice(0, 7));
  const [day, setDay] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "expense" | "income">("all");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<{ entry?: Transaction } | null>(null);
  const [categoryForm, setCategoryForm] = useState<{
    category?: Category;
  } | null>(null);
  const [settings, setSettings] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [toast, setToast] = useState("");
  const [confirmRule, setConfirmRule] = useState<Recurring>();
  const operation = useRef(false);
  const mounted = useRef(true);
  const money = (v: number) => currencyFormat(v, ledger.currency);
  useEffect(() => {
    mounted.current = true;
    whoAmI()
      .then(setEmail)
      .catch((e) => {
        if (e instanceof ApiError && e.status !== 401) setSyncError(e.message);
      })
      .finally(() => setChecking(false));
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  const sync = useCallback(async () => {
    if (!email || demo || operation.current) return;
    operation.current = true;
    setSyncing(true);
    try {
      let snapshot = await fetchLedger();
      const due = materialize(snapshot.ledger);
      if (JSON.stringify(due) !== JSON.stringify(snapshot.ledger))
        snapshot = await mutateLedger((l) => l);
      if (mounted.current) {
        setLedger(snapshot.ledger);
        ledgerRef.current = snapshot.ledger;
        setSyncError("");
      }
    } catch (e) {
      if (mounted.current)
        setSyncError(
          e instanceof Error ? e.message : "Sync failed. Please try again.",
        );
    } finally {
      operation.current = false;
      if (mounted.current) setSyncing(false);
    }
  }, [email, demo]);
  useEffect(() => {
    if (!email || demo) return;
    sync();
    const timer = setInterval(() => {
      if (AppState.currentState === "active" || Platform.OS === "web") sync();
    }, 15000);
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") sync();
    });
    return () => {
      clearInterval(timer);
      listener.remove();
    };
  }, [sync, email, demo]);
  async function commit(change: (l: Ledger) => Ledger, message: string) {
    if (operation.current)
      throw new Error("Sync is finishing. Please try again in a moment.");
    operation.current = true;
    setSyncing(true);
    try {
      const next = demo
        ? materialize(change(ledgerRef.current))
        : (await mutateLedger(change)).ledger;
      setLedger(next);
      ledgerRef.current = next;
      setSyncError("");
      setToast(message);
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Could not save.");
      throw e;
    } finally {
      operation.current = false;
      setSyncing(false);
    }
  }
  async function saveEntry(transaction: Transaction, recurring?: Recurring) {
    const original = form?.entry;
    await commit(
      (l) => {
        if (!l.categories.some((c) => c.id === transaction.categoryId))
          throw new Error(
            "This category was removed on another device. Choose another category.",
          );
        if (
          original &&
          JSON.stringify(l.transactions.find((t) => t.id === original.id)) !==
            JSON.stringify(original)
        )
          throw new Error(
            "This entry changed on another device. Close this form and reopen the entry to review the latest version.",
          );
        return {
          ...l,
          transactions: [
            ...l.transactions.filter((t) => t.id !== transaction.id),
            transaction,
          ],
          recurring: recurring ? [...l.recurring, recurring] : l.recurring,
        };
      },
      original
        ? "Changes saved"
        : `${transaction.kind === "expense" ? "Expense" : "Income"} added`,
    );
    setMonth(transaction.date.slice(0, 7));
    setDay(null);
  }
  const monthEntries = ledger.transactions.filter((t) =>
    t.date.startsWith(month),
  );
  const summary = totals(monthEntries);
  const visibleEntries = monthEntries
    .filter(
      (t) =>
        (!day || t.date === day) &&
        (filter === "all" || t.kind === filter) &&
        `${t.title} ${t.note} ${ledger.categories.find((c) => c.id === t.categoryId)?.name ?? ""}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const grouped = new Map<string, Transaction[]>();
  visibleEntries.forEach((t) =>
    grouped.set(t.date, [...(grouped.get(t.date) ?? []), t]),
  );
  const spending = ledger.categories
    .filter((c) => c.kind === "expense")
    .map((c) => ({
      ...c,
      amount: monthEntries
        .filter((t) => t.categoryId === c.id)
        .reduce((sum, t) => sum + t.share, 0),
    }))
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const monthDate = parseDate(`${month}-01`);
  const monthLabel = monthDate.toLocaleDateString("en-CA", {
    month: "long",
    year: "numeric",
  });
  function shiftMonth(delta: number) {
    setMonth(
      dateKey(
        new Date(monthDate.getFullYear(), monthDate.getMonth() + delta, 1),
      ).slice(0, 7),
    );
    setDay(null);
  }
  const daysInMonth = new Date(
    monthDate.getFullYear(),
    monthDate.getMonth() + 1,
    0,
  ).getDate();
  const offset = (monthDate.getDay() + 6) % 7;
  const calendarCells = Math.ceil((daysInMonth + offset) / 7) * 7;
  function openDemo() {
    setDemo(true);
    setLedger(demoLedger());
    setSyncError("");
  }
  function leaveDemo() {
    setDemo(false);
    setLedger(emptyLedger());
    setTab("Overview");
    setDay(null);
  }
  if (checking)
    return (
      <View style={a.loading}>
        <Icon name="leaf-outline" color={C.accent} size={40} />
        <Text style={s.muted}>Making a little room for clarity…</Text>
      </View>
    );
  if (!email && !demo)
    return (
      <Auth
        onReady={(address) => {
          setLedger(emptyLedger());
          setEmail(address);
          setSyncError("");
        }}
        onDemo={openDemo}
      />
    );
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
                <Pressable accessibilityRole="button" onPress={leaveDemo}>
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
              {!compact && (
                <Button
                  title={tab === "Categories" ? "New category" : "Add entry"}
                  icon="add"
                  onPress={() =>
                    tab === "Categories" ? setCategoryForm({}) : setForm({})
                  }
                />
              )}
            </View>
            {syncError && (
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
            {compact && (
              <Button
                title={tab === "Categories" ? "New category" : "Add entry"}
                icon="add"
                onPress={() =>
                  tab === "Categories" ? setCategoryForm({}) : setForm({})
                }
              />
            )}
            {tab === "Overview" && (
              <>
                <View style={s.between}>
                  <View style={[s.row, { gap: 4 }]}>
                    <IconButton
                      icon="chevron-back"
                      label="Previous month"
                      onPress={() => shiftMonth(-1)}
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Go to current month"
                      onPress={() => {
                        setMonth(dateKey().slice(0, 7));
                        setDay(null);
                      }}
                    >
                      <Text
                        style={{
                          color: C.ink,
                          fontSize: 16,
                          fontWeight: "600",
                          minWidth: compact ? 150 : 165,
                          textAlign: "center",
                        }}
                      >
                        {monthLabel}
                      </Text>
                    </Pressable>
                    <IconButton
                      icon="chevron-forward"
                      label="Next month"
                      onPress={() => shiftMonth(1)}
                    />
                  </View>
                  <Text style={{ fontSize: 11, color: C.muted }}>
                    {ledger.currency}
                  </Text>
                </View>
                <View
                  style={[
                    s.row,
                    { alignItems: "stretch", gap: compact ? 8 : 18 },
                  ]}
                >
                  {[
                    {
                      label: "Income",
                      amount: summary.income,
                      icon: "arrow-down-outline",
                      color: C.green,
                      bg: C.pale,
                    },
                    {
                      label: "Expenses",
                      amount: summary.expense,
                      icon: "arrow-up-outline",
                      color: C.accent,
                      bg: C.orangeBg,
                    },
                    {
                      label: "Net income",
                      amount: summary.income - summary.expense,
                      icon: "wallet-outline",
                      color: C.ink,
                      bg: "#E9EEE6",
                    },
                  ].map((stat, i) => (
                    <View
                      key={stat.label}
                      style={[
                        a.stat,
                        { padding: compact ? 13 : 23 },
                        i === 2 && {
                          backgroundColor: "#EEF2E9",
                          borderColor: "#E3E9DC",
                        },
                      ]}
                    >
                      <View style={[s.between, { gap: 3 }]}>
                        <Text
                          style={{
                            fontSize: compact ? 10 : 12,
                            color: C.muted,
                          }}
                        >
                          {stat.label}
                        </Text>
                        {!compact && (
                          <View
                            style={{
                              backgroundColor: stat.bg,
                              padding: 7,
                              borderRadius: 10,
                            }}
                          >
                            <Icon
                              name={stat.icon}
                              size={16}
                              color={stat.color}
                            />
                          </View>
                        )}
                      </View>
                      <Text
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        style={{
                          fontSize: compact ? 21 : 30,
                          letterSpacing: -1,
                          color: stat.color,
                          fontWeight: "500",
                          marginTop: compact ? 12 : 14,
                        }}
                      >
                        {money(stat.amount)}
                      </Text>
                      {!compact && (
                        <Text
                          style={{ fontSize: 10, color: C.muted, marginTop: 7 }}
                        >
                          {i === 0
                            ? "Money coming your way"
                            : i === 1
                              ? "Your share of spending"
                              : "Income minus expenses"}
                        </Text>
                      )}
                    </View>
                  ))}
                </View>
                <View
                  style={{
                    flexDirection: desktop ? "row" : "column",
                    gap: 22,
                    alignItems: "stretch",
                  }}
                >
                  <View
                    style={[
                      s.card,
                      {
                        flex: desktop ? 1.45 : undefined,
                        padding: compact ? 16 : 24,
                      },
                    ]}
                  >
                    <View style={[s.between, { marginBottom: 22 }]}>
                      <Text style={s.heading}>A month in little moments</Text>
                      <Icon name="calendar-outline" color={C.muted} size={18} />
                    </View>
                    <View style={s.row}>
                      {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                        <Text
                          key={i}
                          style={{
                            flex: 1,
                            textAlign: "center",
                            fontSize: 10,
                            color: C.muted,
                            paddingBottom: 12,
                          }}
                        >
                          {d}
                        </Text>
                      ))}
                    </View>
                    <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                      {Array.from({ length: calendarCells }, (_, index) => {
                        const n = index - offset + 1;
                        const date = `${month}-${String(n).padStart(2, "0")}`;
                        const today = date === dateKey();
                        const selected = day === date;
                        const entries = monthEntries.filter(
                          (t) => t.date === date,
                        );
                        const hasIncome = entries.some(
                          (t) => t.kind === "income",
                        );
                        const hasExpense = entries.some(
                          (t) => t.kind === "expense",
                        );
                        return (
                          <View
                            key={index}
                            style={{ width: `${100 / 7}%`, padding: 2 }}
                          >
                            {n > 0 && n <= daysInMonth ? (
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`${monthLabel} ${n}${entries.length ? `, ${entries.length} entries` : ""}`}
                                accessibilityState={{ selected }}
                                onPress={() =>
                                  setDay(day === date ? null : date)
                                }
                                style={{
                                  height: compact ? 44 : 48,
                                  borderRadius: 11,
                                  justifyContent: "center",
                                  alignItems: "center",
                                  gap: 5,
                                  backgroundColor: selected
                                    ? C.ink
                                    : today
                                      ? C.orangeBg
                                      : "transparent",
                                }}
                              >
                                <Text
                                  style={{
                                    color: selected
                                      ? "#fff"
                                      : today
                                        ? C.accent
                                        : C.ink,
                                    fontWeight:
                                      today || selected ? "700" : "400",
                                    fontSize: 12,
                                  }}
                                >
                                  {n}
                                </Text>
                                <View
                                  style={{
                                    flexDirection: "row",
                                    height: 4,
                                    gap: 3,
                                  }}
                                >
                                  {hasExpense && (
                                    <View
                                      style={{
                                        width: 4,
                                        height: 4,
                                        borderRadius: 4,
                                        backgroundColor: C.accent,
                                      }}
                                    />
                                  )}
                                  {hasIncome && (
                                    <View
                                      style={{
                                        width: 4,
                                        height: 4,
                                        borderRadius: 4,
                                        backgroundColor: "#79A185",
                                      }}
                                    />
                                  )}
                                </View>
                              </Pressable>
                            ) : (
                              <View style={{ height: compact ? 44 : 48 }} />
                            )}
                          </View>
                        );
                      })}
                    </View>
                    <View
                      style={[
                        s.row,
                        { justifyContent: "center", paddingTop: 18, gap: 16 },
                      ]}
                    >
                      {[
                        [C.green, "Income"],
                        [C.accent, "Expense"],
                      ].map(([color, label]) => (
                        <View key={label} style={[s.row, { gap: 5 }]}>
                          <View
                            style={{
                              width: 5,
                              height: 5,
                              borderRadius: 5,
                              backgroundColor: color,
                            }}
                          />
                          <Text style={{ color: C.muted, fontSize: 10 }}>
                            {label}
                          </Text>
                        </View>
                      ))}
                      {day && (
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => setDay(null)}
                        >
                          <Text style={{ color: C.accent, fontSize: 11 }}>
                            Show whole month
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                  <View
                    style={[
                      s.card,
                      { flex: desktop ? 1 : undefined, minHeight: 300 },
                    ]}
                  >
                    <View style={[s.between, { marginBottom: 24 }]}>
                      <Text style={s.heading}>Where it went</Text>
                      <Icon
                        name="pie-chart-outline"
                        color={C.muted}
                        size={18}
                      />
                    </View>
                    {spending.length ? (
                      <View style={{ gap: 19 }}>
                        {spending.slice(0, 5).map((c) => (
                          <View key={c.id} style={{ gap: 9 }}>
                            <View style={s.between}>
                              <View style={[s.row, { gap: 8 }]}>
                                <Icon name={c.icon} size={16} color={c.color} />
                                <Text style={{ color: C.ink, fontSize: 12 }}>
                                  {c.name}
                                </Text>
                              </View>
                              <Text
                                style={{
                                  color: C.ink,
                                  fontSize: 12,
                                  fontWeight: "600",
                                }}
                              >
                                {money(c.amount)}
                              </Text>
                            </View>
                            <View
                              style={{
                                height: 5,
                                backgroundColor: C.bg,
                                borderRadius: 4,
                              }}
                            >
                              <View
                                style={{
                                  height: 5,
                                  width: `${(c.amount / summary.expense) * 100}%`,
                                  backgroundColor: c.color,
                                  borderRadius: 4,
                                }}
                              />
                            </View>
                          </View>
                        ))}
                        <Text
                          style={{ fontSize: 10, color: C.muted, marginTop: 1 }}
                        >
                          {spending.length > 5 ? "Top 5 categories · " : ""}
                          Based on your share, including split receipts.
                        </Text>
                      </View>
                    ) : (
                      <View
                        style={{
                          flex: 1,
                          justifyContent: "center",
                          alignItems: "center",
                          gap: 12,
                          paddingVertical: 36,
                        }}
                      >
                        <View style={a.emptyIcon}>
                          <Icon
                            name="pie-chart-outline"
                            size={28}
                            color={C.green}
                          />
                        </View>
                        <Text style={{ color: C.ink, fontSize: 14 }}>
                          A fresh start.
                        </Text>
                        <Text
                          style={[
                            s.muted,
                            { textAlign: "center", maxWidth: 210 },
                          ]}
                        >
                          Add an expense and your spending picture will take
                          shape here.
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
                <MoneyFlowChart key={month} entries={monthEntries} categories={ledger.categories} currency={ledger.currency} monthLabel={monthLabel} />
                <View style={[s.card, { padding: compact ? 16 : 24 }]}>
                  <View style={[s.between, { marginBottom: 20 }]}>
                    <Text style={s.heading}>
                      {day
                        ? parseDate(day).toLocaleDateString("en-CA", {
                            month: "long",
                            day: "numeric",
                          })
                        : "Your entries"}{" "}
                      <Text
                        style={{
                          color: C.muted,
                          fontWeight: "400",
                          fontSize: 12,
                        }}
                      >
                        {" "}
                        {visibleEntries.length}
                      </Text>
                    </Text>
                    <View
                      style={[
                        s.row,
                        {
                          gap: 3,
                          backgroundColor: C.bg,
                          padding: 4,
                          borderRadius: 9,
                        },
                      ]}
                    >
                      {(["all", "expense", "income"] as const).map((f) => (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityState={{ selected: filter === f }}
                          key={f}
                          onPress={() => setFilter(f)}
                          style={{
                            paddingVertical: 7,
                            paddingHorizontal: compact ? 7 : 12,
                            backgroundColor:
                              filter === f ? "#fff" : "transparent",
                            borderRadius: 6,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 10,
                              color: filter === f ? C.ink : C.muted,
                            }}
                          >
                            {f === "all"
                              ? "All"
                              : f === "expense"
                                ? "Expenses"
                                : "Income"}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                  <Field
                    label="Search entries"
                    placeholder="Search by name, category, or note…"
                    value={search}
                    onChangeText={setSearch}
                    style={{ fontSize: 12, minHeight: 40, paddingVertical: 10 }}
                  />
                  {visibleEntries.length ? (
                    [...grouped].map(([date, entries]) => (
                      <View key={date}>
                        <Text style={a.dateLabel}>
                          {date === dateKey()
                            ? "TODAY"
                            : parseDate(date)
                                .toLocaleDateString("en-CA", {
                                  weekday: "long",
                                  month: "short",
                                  day: "numeric",
                                })
                                .toUpperCase()}
                        </Text>
                        {entries.map((t) => {
                          const c = ledger.categories.find(
                            (c) => c.id === t.categoryId,
                          );
                          return (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Edit ${t.title}, ${money(t.share)}`}
                              onPress={() => setForm({ entry: t })}
                              key={t.id}
                              style={({ pressed }) => [
                                a.entryRow,
                                { opacity: pressed ? 0.55 : 1 },
                              ]}
                            >
                              <View
                                style={[
                                  a.categoryIcon,
                                  {
                                    backgroundColor: `${c?.color ?? C.muted}15`,
                                  },
                                ]}
                              >
                                <Icon
                                  name={c?.icon ?? "ellipse-outline"}
                                  color={c?.color ?? C.muted}
                                  size={20}
                                />
                              </View>
                              <View style={{ flex: 1, gap: 6 }}>
                                <View
                                  style={[s.row, { gap: 6, flexWrap: "wrap" }]}
                                >
                                  <Text
                                    style={{
                                      color: C.ink,
                                      fontSize: 13,
                                      fontWeight: "500",
                                    }}
                                  >
                                    {t.title}
                                  </Text>
                                  {t.recurringId && (
                                    <Icon
                                      name="repeat-outline"
                                      size={12}
                                      color={C.muted}
                                    />
                                  )}
                                  {t.receipt && (
                                    <Icon
                                      name="attach"
                                      size={13}
                                      color={C.muted}
                                    />
                                  )}
                                </View>
                                <View
                                  style={[s.row, { gap: 7, flexWrap: "wrap" }]}
                                >
                                  <Text
                                    style={{ color: C.muted, fontSize: 11 }}
                                  >
                                    {c?.name}
                                  </Text>
                                  {t.share !== t.total && (
                                    <Tag text="SPLIT" color={C.accent} />
                                  )}
                                </View>
                              </View>
                              <View style={{ alignItems: "flex-end", gap: 6 }}>
                                <Text
                                  style={{
                                    fontSize: 14,
                                    fontWeight: "500",
                                    color:
                                      t.kind === "income" ? C.green : C.ink,
                                  }}
                                >
                                  {t.kind === "income" ? "+" : "−"}
                                  {money(t.share)}
                                </Text>
                                {t.share !== t.total && (
                                  <Text
                                    style={{ fontSize: 10, color: C.muted }}
                                  >
                                    of {money(t.total)}
                                  </Text>
                                )}
                              </View>
                              <Icon
                                name="chevron-forward"
                                size={13}
                                color="#BBC3BD"
                              />
                            </Pressable>
                          );
                        })}
                      </View>
                    ))
                  ) : (
                    <View
                      style={{
                        alignItems: "center",
                        paddingVertical: 40,
                        gap: 12,
                      }}
                    >
                      <View style={a.emptyIcon}>
                        <Icon
                          name="receipt-outline"
                          size={27}
                          color={C.green}
                        />
                      </View>
                      <Text
                        style={{
                          color: C.ink,
                          fontWeight: "500",
                          fontSize: 15,
                        }}
                      >
                        {search || day || filter !== "all"
                          ? "No entries found."
                          : "Your next little moment starts here."}
                      </Text>
                      <Text style={[s.muted, { textAlign: "center" }]}>
                        {search || day || filter !== "all"
                          ? "Try a different search, day, or filter."
                          : "Add an income or expense. We’ll take it from there."}
                      </Text>
                      {!search && !day && filter === "all" && (
                        <Button
                          title="Add your first entry"
                          icon="add"
                          onPress={() => setForm({})}
                        />
                      )}
                    </View>
                  )}
                </View>
              </>
            )}
            {tab === "Recurring" && (
              <>
                <View style={[s.card, { backgroundColor: C.pale, gap: 8 }]}>
                  <View style={s.row}>
                    <Icon name="repeat-outline" color={C.green} />
                    <Text style={s.heading}>A little less to remember.</Text>
                  </View>
                  <Text style={s.muted}>
                    Choose a repeat schedule when adding an entry. Due entries
                    are added once when you open the app. Pausing a schedule
                    skips its paused dates.
                  </Text>
                </View>
                {ledger.recurring.length ? (
                  ledger.recurring.map((rule) => {
                    const c = ledger.categories.find(
                      (c) => c.id === rule.categoryId,
                    );
                    return (
                      <View key={rule.id} style={[s.card, { gap: 20 }]}>
                        <View style={s.row}>
                          <View
                            style={[
                              a.categoryIcon,
                              { backgroundColor: `${c?.color}15` },
                            ]}
                          >
                            <Icon
                              name={c?.icon ?? "repeat-outline"}
                              color={c?.color}
                            />
                          </View>
                          <View style={{ flex: 1, gap: 5 }}>
                            <Text
                              style={{
                                color: C.ink,
                                fontSize: 16,
                                fontWeight: "600",
                              }}
                            >
                              {rule.title}
                            </Text>
                            <Text style={s.muted}>
                              {rule.frequency[0].toUpperCase() +
                                rule.frequency.slice(1)}{" "}
                              · {c?.name}
                            </Text>
                          </View>
                          <Text
                            style={{
                              color: rule.kind === "income" ? C.green : C.ink,
                              fontSize: 20,
                              fontWeight: "500",
                            }}
                          >
                            {rule.kind === "income" ? "+" : "−"}
                            {money(rule.share)}
                          </Text>
                        </View>
                        <View
                          style={[s.between, compact && { flexWrap: "wrap" }]}
                        >
                          <Tag
                            text={
                              rule.active
                                ? `NEXT · ${parseDate(rule.nextDate).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}`
                                : "PAUSED"
                            }
                            color={rule.active ? C.green : C.muted}
                          />
                          <View style={s.row}>
                            <Button
                              title={rule.active ? "Pause" : "Resume"}
                              tone="quiet"
                              icon={
                                rule.active ? "pause-outline" : "play-outline"
                              }
                              onPress={async () => {
                                try {
                                  await commit(
                                    (l) => ({
                                      ...l,
                                      recurring: l.recurring.map((r) => {
                                        if (r.id !== rule.id) return r;
                                        let nextDate = r.nextDate;
                                        if (!rule.active)
                                          while (nextDate <= dateKey())
                                            nextDate = nextOccurrence(
                                              nextDate,
                                              r.frequency,
                                              r.anchorDay,
                                            );
                                        return {
                                          ...r,
                                          active: !rule.active,
                                          nextDate,
                                        };
                                      }),
                                    }),
                                    rule.active
                                      ? "Schedule paused"
                                      : "Schedule resumed",
                                  );
                                } catch {}
                              }}
                            />
                            <IconButton
                              icon="trash-outline"
                              label={`Delete ${rule.title} schedule`}
                              onPress={() => setConfirmRule(rule)}
                            />
                          </View>
                        </View>
                      </View>
                    );
                  })
                ) : (
                  <View
                    style={[
                      s.card,
                      { alignItems: "center", gap: 16, padding: 44 },
                    ]}
                  >
                    <View style={a.emptyIcon}>
                      <Icon name="repeat-outline" size={28} color={C.green} />
                    </View>
                    <Text style={s.heading}>Rent, payday, the usuals.</Text>
                    <Text style={[s.muted, { textAlign: "center" }]}>
                      Add an entry and choose weekly, monthly, or yearly to give
                      it a routine.
                    </Text>
                    <Button
                      title="Add a recurring entry"
                      icon="add"
                      onPress={() => setForm({})}
                    />
                  </View>
                )}
              </>
            )}
            {tab === "Categories" && (
              <>
                {(["expense", "income"] as const).map((kind) => (
                  <View key={kind} style={{ gap: 14 }}>
                    <Text style={a.eyebrow}>
                      {kind === "expense"
                        ? "EXPENSE CATEGORIES"
                        : "INCOME CATEGORIES"}
                    </Text>
                    <View
                      style={{
                        flexDirection: "row",
                        flexWrap: "wrap",
                        gap: 12,
                      }}
                    >
                      {ledger.categories
                        .filter((c) => c.kind === kind)
                        .map((c) => (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Edit category ${c.name}`}
                            onPress={() => setCategoryForm({ category: c })}
                            key={c.id}
                            style={[
                              s.card,
                              {
                                width: compact ? "100%" : "48%",
                                padding: 20,
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 14,
                              },
                            ]}
                          >
                            <View
                              style={[
                                a.categoryIcon,
                                { backgroundColor: `${c.color}15` },
                              ]}
                            >
                              <Icon name={c.icon} color={c.color} />
                            </View>
                            <Text
                              style={{ color: C.ink, fontSize: 14, flex: 1 }}
                            >
                              {c.name}
                            </Text>
                            <Icon
                              name="create-outline"
                              size={17}
                              color={C.muted}
                            />
                          </Pressable>
                        ))}
                    </View>
                  </View>
                ))}
              </>
            )}
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
      {toast && (
        <View accessibilityRole="alert" style={a.toast}>
          <Icon name="checkmark-circle" color="#B4D7B6" size={18} />
          <Text style={{ color: "white", fontSize: 13 }}>{toast}</Text>
        </View>
      )}
      {form && (
        <EntryForm
          demo={demo}
          categories={ledger.categories}
          entry={form.entry}
          currency={ledger.currency}
          onClose={() => setForm(null)}
          onSave={saveEntry}
          onDelete={async (id) => {
            const original = form.entry;
            await commit((l) => {
              if (
                JSON.stringify(l.transactions.find((t) => t.id === id)) !==
                JSON.stringify(original)
              )
                throw new Error(
                  "This entry changed on another device. Reopen it before deleting.",
                );
              return {
                ...l,
                transactions: l.transactions.filter((t) => t.id !== id),
              };
            }, "Entry deleted");
          }}
        />
      )}
      {categoryForm && (
        <CategoryForm
          category={categoryForm.category}
          ledger={ledger}
          onClose={() => setCategoryForm(null)}
          commit={commit}
        />
      )}
      <Sheet
        visible={settings}
        title="Your personal space"
        onClose={() => setSettings(false)}
      >
        <Text style={s.muted}>
          {demo
            ? "You are exploring sample data. Nothing here changes your account."
            : `Signed in as ${email}. Your entries and receipts sync through your own server.`}
        </Text>
        <Text style={s.label}>Account currency</Text>
        <View style={[s.row, { flexWrap: "wrap" }]}>
          {["CAD", "USD", "EUR", "GBP"].map((c) => (
            <Button
              key={c}
              title={c}
              tone={ledger.currency === c ? "primary" : "quiet"}
              disabled={ledger.transactions.length > 0 && ledger.currency !== c}
              onPress={async () => {
                try {
                  await commit((l) => {
                    if (l.transactions.length || l.recurring.length)
                      throw new Error(
                        "Currency can only be changed before adding entries.",
                      );
                    return { ...l, currency: c };
                  }, "Currency updated");
                } catch {}
              }}
            />
          ))}
        </View>
        <Text style={s.muted}>
          Choose your currency before adding entries. One currency per account
          keeps your totals consistent.
        </Text>
        <Text style={s.muted}>
          Sync runs when the app opens, after each change, and every 15 seconds
          while in use. An internet connection to your server is required to
          save.
        </Text>
        <Button
          title={demo ? "Leave demo" : "Sign out"}
          tone="quiet"
          icon="log-out-outline"
          onPress={async () => {
            if (demo) {
              leaveDemo();
              setSettings(false);
              return;
            }
            if (operation.current) return;
            try {
              await signOut();
              setEmail(null);
              setLedger(emptyLedger());
              setSettings(false);
              setTab("Overview");
            } catch (e) {
              setSyncError(
                e instanceof Error ? e.message : "Could not sign out.",
              );
              setSettings(false);
            }
          }}
        />
      </Sheet>
      <Sheet
        visible={!!confirmRule}
        title="Remove this schedule?"
        onClose={() => setConfirmRule(undefined)}
      >
        <Text style={s.muted}>
          Future entries for {confirmRule?.title} will stop. Entries already
          recorded will stay in your history.
        </Text>
        <Button
          title="Remove schedule"
          tone="danger"
          onPress={async () => {
            try {
              await commit(
                (l) => ({
                  ...l,
                  recurring: l.recurring.filter(
                    (r) => r.id !== confirmRule?.id,
                  ),
                }),
                "Schedule removed",
              );
              setConfirmRule(undefined);
            } catch {}
          }}
        />
      </Sheet>
    </SafeAreaView>
  );
}

function CategoryForm({
  category,
  ledger,
  onClose,
  commit,
}: {
  category?: Category;
  ledger: Ledger;
  onClose: () => void;
  commit: (change: (l: Ledger) => Ledger, message: string) => Promise<void>;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [kind, setKind] = useState(category?.kind ?? "expense");
  const [color, setColor] = useState(category?.color ?? palette[0]);
  const [icon, setIcon] = useState(category?.icon ?? "pricetag-outline");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const used =
    category &&
    [...ledger.transactions, ...ledger.recurring].some(
      (t) => t.categoryId === category.id,
    );
  async function save(remove = false) {
    if (!name.trim()) {
      setError("Give your category a name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const item = {
        id: category?.id ?? uid(),
        name: name.trim(),
        kind,
        color,
        icon,
      };
      await commit(
        (l) => {
          if (
            category &&
            JSON.stringify(l.categories.find((c) => c.id === category.id)) !==
              JSON.stringify(category)
          )
            throw new Error(
              "This category changed on another device. Reopen it before editing.",
            );
          if (
            remove &&
            [...l.transactions, ...l.recurring].some(
              (t) => t.categoryId === category?.id,
            )
          )
            throw new Error(
              "This category has entries. Keep it to preserve your history.",
            );
          if (
            !remove &&
            l.categories.some(
              (c) =>
                c.id !== item.id &&
                c.kind === kind &&
                c.name.toLowerCase() === item.name.toLowerCase(),
            )
          )
            throw new Error("You already have a category with this name.");
          return {
            ...l,
            categories: remove
              ? l.categories.filter((c) => c.id !== item.id)
              : category
                ? l.categories.map((c) => (c.id === item.id ? item : c))
                : [...l.categories, item],
          };
        },
        remove ? "Category removed" : "Category saved",
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      visible
      title={category ? "Make it yours." : "A new little category."}
      onClose={onClose}
    >
      <Field
        label="Category name"
        placeholder="e.g. Travel"
        value={name}
        onChangeText={setName}
        maxLength={50}
      />
      {!category && (
        <View style={s.row}>
          {(["expense", "income"] as const).map((k) => (
            <Button
              key={k}
              title={k === "expense" ? "Expense" : "Income"}
              tone={kind === k ? "primary" : "quiet"}
              onPress={() => setKind(k)}
            />
          ))}
        </View>
      )}
      <Text style={s.label}>Color</Text>
      <View style={s.row}>
        {palette.map((c) => (
          <Pressable
            key={c}
            accessibilityRole="button"
            accessibilityLabel={`Color ${c}`}
            accessibilityState={{ selected: color === c }}
            onPress={() => setColor(c)}
            style={{
              backgroundColor: c,
              borderRadius: 22,
              width: 36,
              height: 36,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {color === c && <Icon name="checkmark" color="white" />}
          </Pressable>
        ))}
      </View>
      <Text style={s.label}>Icon</Text>
      <View style={[s.row, { flexWrap: "wrap" }]}>
        {[
          "pricetag-outline",
          "airplane-outline",
          "car-outline",
          "paw-outline",
          "school-outline",
          "fitness-outline",
          "gift-outline",
          "cafe-outline",
          "home-outline",
          "basket-outline",
          "briefcase-outline",
          "heart-outline",
        ].map((i) => (
          <Pressable
            key={i}
            accessibilityRole="button"
            accessibilityLabel={i.replace("-outline", "")}
            accessibilityState={{ selected: icon === i }}
            style={[s.chip, icon === i && s.chipActive]}
            onPress={() => setIcon(i)}
          >
            <Icon name={i} color={color} />
          </Pressable>
        ))}
      </View>
      {error ? <Text style={s.error}>{error}</Text> : null}
      <Button
        title={busy ? "Saving…" : "Save category"}
        onPress={() => save()}
        disabled={busy}
      />
      {category && (
        <Button
          title={used ? "Category is in use" : "Delete unused category"}
          tone="danger"
          onPress={() => save(true)}
          disabled={!!used || busy}
        />
      )}
    </Sheet>
  );
}
const a = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 18,
    backgroundColor: C.bg,
  },
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
  stat: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 18,
    flex: 1,
  },
  emptyIcon: {
    width: 60,
    height: 60,
    borderRadius: 22,
    backgroundColor: C.pale,
    justifyContent: "center",
    alignItems: "center",
  },
  categoryIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  entryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderColor: "#F1F3EF",
  },
  dateLabel: {
    color: "#9AA39B",
    fontSize: 9,
    letterSpacing: 1.2,
    marginTop: 26,
    marginBottom: 3,
    fontWeight: "600",
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
export default function App() {
  return (
    <SafeAreaProvider>
      <Penny />
      <View style={{ position: "absolute", width: 0, height: 0 }}><Slot /></View>
    </SafeAreaProvider>
  );
}
