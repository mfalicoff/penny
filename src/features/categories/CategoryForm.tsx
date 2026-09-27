import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { saveCategory } from "../../domain/commands";
import { palette, uid, type Category, type Ledger } from "../../domain/ledger";
import { Button, Field, Icon, Sheet, s } from "../../shared/ui";
export function CategoryForm({
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
        saveCategory(item, category, remove),
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
