import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { type Category } from "../../domain/ledger";
import { useLedger } from "../../providers/LedgerProvider";
import { Button, C, Icon, s } from "../../shared/ui";
import { useResponsive } from "../../shared/useResponsive";
import { CategoryForm } from "./CategoryForm";

export default function CategoriesScreen() {
  const { ledger } = useLedger();
  const { compact } = useResponsive();
  const [categoryForm, setCategoryForm] = React.useState<{ category?: Category; } | null>(null);
  const { commit } = useLedger();
  return (<View style={{ gap: 26 }}>
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
    <Button title="New category" icon="add" onPress={() => setCategoryForm({})} />
    {categoryForm && <CategoryForm category={categoryForm.category} ledger={ledger} onClose={() => setCategoryForm(null)} commit={commit} />}
  </View>);
}

const a = StyleSheet.create({
  eyebrow: {
    fontSize: 9,
    fontWeight: "600",
    color: "#8A988A",
    letterSpacing: 1.8,
  },
  categoryIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
});
