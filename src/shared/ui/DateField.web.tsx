import { useId } from "react";
import { Text, View } from "react-native";
import { validDate } from "../../domain/ledger";
import { C, s } from "./index";
import type { DateFieldProps } from "./DateField";

export function DateField({ label, value, onChange }: DateFieldProps) {
  const id = useId();
  return <View style={{ gap: 8 }}>
    <Text nativeID={id} style={s.label}>{label}</Text>
    <input type="date" aria-label={label} aria-labelledby={id} value={value}
      min="2000-01-01" max="2100-12-31" required
      onChange={(event) => { if (validDate(event.target.value)) onChange(event.target.value); }}
      style={{ boxSizing: "border-box", width: "100%", minWidth: 0, minHeight: 48,
        padding: "12px 14px", border: `1px solid ${C.line}`, borderRadius: 10,
        backgroundColor: "#fff", color: C.ink, fontSize: 16, fontFamily: "inherit", colorScheme: "light" }} />
  </View>;
}
