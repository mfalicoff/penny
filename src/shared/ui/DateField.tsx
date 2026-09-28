import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { useState } from "react";
import { Platform, Pressable, Text, useWindowDimensions, View } from "react-native";
import { dateKey, parseDate } from "../../domain/ledger";
import { Button, C, Icon, s } from "./index";

export type DateFieldProps = { label: string; value: string; onChange: (value: string) => void; pill?: boolean; iconOnly?: boolean };

export function DateField({ label, value, onChange, pill = false, iconOnly = false }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const { width } = useWindowDimensions();
  const triggerSize = iconOnly && width < 360 ? 30 : 34;
  const calendarWidth = Math.min(280, width - 48);
  return <View style={{ gap: 8, width: iconOnly ? triggerSize : pill ? undefined : "100%", alignItems: pill ? "flex-end" : "stretch", zIndex: open ? 12 : 0 }}>
    {!pill && <Text style={s.label}>{label}</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel={label}
      accessibilityValue={{ text: value }} accessibilityState={{ expanded: open }}
      onPress={() => setOpen(!open)} style={iconOnly ? [s.chip, {
        width: triggerSize, height: triggerSize, minHeight: triggerSize, paddingHorizontal: 0, paddingVertical: 0,
        justifyContent: "center", borderRadius: 999, backgroundColor: open ? C.orangeBg : C.bg,
      }] : pill ? [s.chip, { minHeight: 44, borderRadius: 999, backgroundColor: C.bg }] : [s.input, s.between]}>
      {pill && <Icon name="calendar-outline" color={C.muted} size={17} />}
      {!iconOnly && <Text style={{ color: C.ink, fontSize: pill ? 13 : 15 }}>{parseDate(value).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" })}</Text>}
      {!pill && <Icon name="calendar-outline" color={C.muted} size={20} />}
    </Pressable>
    {open && <>
      <View style={pill && Platform.OS === "ios" ? {
        position: "absolute", top: iconOnly ? triggerSize + 6 : 50,
        ...(iconOnly ? { left: -Math.round((calendarWidth - triggerSize) / 2), width: calendarWidth } : { right: 0, width: Math.min(320, width - 40) }),
        padding: 12, backgroundColor: C.paper, borderRadius: 16, borderWidth: 1,
        borderColor: C.line, elevation: 12, boxShadow: "0px 12px 32px #1C302B20",
      } : { alignSelf: "stretch" }}><DateTimePicker value={parseDate(value)} mode="date" presentation="dialog"
        display={Platform.OS === "ios" ? "inline" : "default"}
        minimumDate={parseDate("2000-01-01")} maximumDate={parseDate("2100-12-31")}
        accentColor={C.accent}
        onValueChange={(_event, selected) => {
          onChange(dateKey(selected));
          if (Platform.OS === "android") setOpen(false);
        }}
        onDismiss={() => setOpen(false)} />
        {Platform.OS === "ios" && <Button title="Done choosing date" tone="quiet" onPress={() => setOpen(false)} />}
      </View>
    </>}
  </View>;
}
