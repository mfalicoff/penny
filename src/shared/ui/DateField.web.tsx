import { getTheme } from "../theme";
import { useId, useState } from "react";
import { Text, useWindowDimensions, View } from "react-native";
import { validDate } from "../../domain/ledger";
import { C, Icon, s } from "./index";
import type { DateFieldProps } from "./DateField";

export function DateField({ label, value, onChange, pill = false, iconOnly = false }: DateFieldProps) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const { width } = useWindowDimensions();
  const triggerSize = iconOnly && width < 360 ? 30 : 34;
  return <View style={{ gap: 8, position: "relative", width: iconOnly ? triggerSize : pill ? undefined : "100%", alignItems: pill ? "flex-end" : "stretch" }}>
    {!pill && <Text nativeID={id} style={s.label}>{label}</Text>}
    {iconOnly && <View style={{ width: triggerSize, height: triggerSize, borderRadius: 999, borderWidth: 1, borderColor: focused ? C.accent : C.line,
      backgroundColor: C.bg, alignItems: "center", justifyContent: "center" }}>
      <Icon name="calendar-outline" color={C.muted} size={17} />
    </View>}
    <input type="date" aria-label={label} aria-labelledby={pill ? undefined : id} value={value}
      min="2000-01-01" max="2100-12-31" required
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onChange={(event) => { if (validDate(event.target.value)) onChange(event.target.value); }}
      style={{ boxSizing: "border-box", width: iconOnly ? triggerSize : pill ? "auto" : "100%", minWidth: 0, minHeight: iconOnly ? triggerSize : pill ? 44 : 48,
        padding: pill ? "9px 14px" : "12px 14px", border: `1px solid ${C.line}`, borderRadius: pill ? 999 : 10,
        backgroundColor: pill ? C.bg : C.input, color: C.ink, fontSize: pill ? 13 : 16, fontFamily: "inherit", colorScheme: getTheme() === "light" ? "light" : "dark",
        ...(iconOnly ? { position: "absolute", top: 0, left: 0, opacity: 0, padding: 0, cursor: "pointer" } : {}) }} />
  </View>;
}
