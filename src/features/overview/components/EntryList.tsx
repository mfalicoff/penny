import { Pressable, StyleSheet, Text, View } from "react-native";
import { dateKey, parseDate, type Ledger, type Transaction } from "../../../domain/ledger";
import { Button, C, Field, Icon, Tag, s } from "../../../shared/ui";
import { type EntryFilter } from "../selectors";

type EntryListProps = {
  day: string | null;
  filter: EntryFilter;
  search: string;
  setFilter: (filter: EntryFilter) => void;
  setSearch: (search: string) => void;
  visibleEntries: Transaction[];
  grouped: Map<string, Transaction[]>;
  ledger: Ledger;
  compact: boolean;
  money: (value: number) => string;
  setForm: (form: { entry?: Transaction }) => void;
};

export function EntryList({
  day, filter, search, setFilter, setSearch,
  visibleEntries, grouped, ledger, compact, money, setForm,
}: EntryListProps) {

  return (
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

  );
}

const a = StyleSheet.create({
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
});
