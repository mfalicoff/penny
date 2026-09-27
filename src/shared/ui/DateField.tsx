import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { dateKey, parseDate } from "../../domain/ledger";
import { Button, C, Icon, s } from "./index";

export type DateFieldProps = { label: string; value: string; onChange: (value: string) => void };

export function DateField({ label, value, onChange }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  return <View style={{ gap: 8 }}>
    <Text style={s.label}>{label}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={label}
      accessibilityValue={{ text: value }} accessibilityState={{ expanded: open }}
      onPress={() => setOpen(!open)} style={[s.input, s.between]}>
      <Text style={{ color: C.ink }}>{parseDate(value).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" })}</Text>
      <Icon name="calendar-outline" color={C.muted} size={20} />
    </Pressable>
    {open && <>
      <DateTimePicker value={parseDate(value)} mode="date" presentation="dialog"
        display={Platform.OS === "ios" ? "inline" : "default"}
        minimumDate={parseDate("2000-01-01")} maximumDate={parseDate("2100-12-31")}
        accentColor={C.accent}
        onValueChange={(_event, selected) => {
          onChange(dateKey(selected));
          if (Platform.OS === "android") setOpen(false);
        }}
        onDismiss={() => setOpen(false)} />
      {Platform.OS === "ios" && <Button title="Done choosing date" tone="quiet" onPress={() => setOpen(false)} />}
    </>}
  </View>;
}
