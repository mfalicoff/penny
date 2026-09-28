import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { C, Icon, s } from "../../shared/ui";

export type PillOption = { id: string; label: string; icon?: string; color?: string; accessibilityLabel?: string };

export function EntryPillPicker({ label, value, options, open, iconOnly = false, align = "left", onToggle, onSelect, emptyMessage, footerAction }: {
  label: string;
  value: string;
  options: PillOption[];
  open: boolean;
  align?: "left" | "center" | "right";
  iconOnly?: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  emptyMessage?: string;
  footerAction?: { label: string; onPress: () => void };
}) {
  const { width, height } = useWindowDimensions();
  const anchor = useRef<View>(null);
  const [above, setAbove] = useState(false);
  const [menuLeft, setMenuLeft] = useState<number | null>(null);
  const triggerSize = iconOnly && width < 360 ? 30 : 34;
  const menuWidth = Math.min(iconOnly ? 230 : 250, width - (iconOnly ? 48 : 90));
  useEffect(() => {
    if (open) anchor.current?.measureInWindow((x, y, triggerWidth, triggerHeight) => {
      setAbove(height - y - triggerHeight < 260 && y > 260);
      const preferredLeft = align === "right" ? x + triggerWidth - menuWidth
        : align === "center" ? x + (triggerWidth - menuWidth) / 2 : x;
      setMenuLeft(Math.max(16, Math.min(preferredLeft, width - menuWidth - 16)) - x);
    });
  }, [open, height, width, align, menuWidth]);
  const selected = options.find((option) => option.id === value);
  return <View ref={anchor} style={{ position: "relative", zIndex: open ? 3 : 0 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${selected?.label ?? "Choose"}`}
      accessibilityState={{ expanded: open }} onPress={onToggle}
      style={[s.chip, iconOnly ? {
        width: triggerSize, height: triggerSize, minHeight: triggerSize, paddingHorizontal: 0, paddingVertical: 0,
        justifyContent: "center", borderRadius: 999, backgroundColor: open ? C.orangeBg : C.bg,
      } : { minHeight: 44, borderRadius: 999, backgroundColor: C.bg, maxWidth: 245 }]}>
      {selected?.icon && <Icon name={selected.icon} size={17} color={selected.color ?? C.muted} />}
      {!selected?.icon && <Icon name={label === "Trip" ? "airplane-outline" : label === "Account" ? "wallet-outline" : "pricetag-outline"} size={17} color={C.muted} />}
      {!iconOnly && <>
        <Text numberOfLines={1} style={{ color: C.ink, fontSize: 13, flexShrink: 1 }}>
          <Text style={{ color: C.muted }}>{label} · </Text>{selected?.label ?? "Choose"}
        </Text>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={14} color={C.muted} />
      </>}
    </Pressable>
    {open && <View style={{
      position: "absolute", ...(above ? { bottom: iconOnly ? triggerSize + 6 : 50 } : { top: iconOnly ? triggerSize + 6 : 50 }),
      ...(menuLeft === null ? align === "right" ? { right: 0 }
        : align === "center" ? { left: -Math.round((menuWidth - triggerSize) / 2) } : { left: 0 }
        : { left: menuLeft }),
      width: menuWidth, maxHeight: 250, backgroundColor: C.paper,
      borderWidth: 1, borderColor: C.line, borderRadius: 16,
      padding: 8, elevation: 12, boxShadow: "0px 12px 32px #1C302B20",
    }}>
      <Text style={[s.label, { paddingHorizontal: 10, paddingVertical: 7 }]}>Choose {label.toLowerCase()}</Text>
      <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={{ maxHeight: 196 }}>
        {options.map((option) => <Pressable key={option.id} accessibilityRole="button"
          accessibilityLabel={option.accessibilityLabel ?? option.label}
          accessibilityState={{ selected: value === option.id }}
          onPress={() => onSelect(option.id)}
          style={[s.row, { minHeight: 44, paddingHorizontal: 10, borderRadius: 10, backgroundColor: value === option.id ? C.orangeBg : C.paper }]}>
          {option.icon && <Icon name={option.icon} color={option.color ?? C.muted} size={18} />}
          <Text numberOfLines={1} style={{ flex: 1, color: C.ink, fontSize: 13 }}>{option.label}</Text>
          {value === option.id && <Icon name="checkmark" color={C.accent} size={18} />}
        </Pressable>)}
        {emptyMessage && <Text style={[s.muted, { padding: 10 }]}>{emptyMessage}</Text>}
      </ScrollView>
      {footerAction && <Pressable accessibilityRole="button" accessibilityLabel={footerAction.label}
        onPress={footerAction.onPress} style={[s.row, { minHeight: 44, paddingHorizontal: 10, borderTopWidth: 1, borderColor: C.line }]}>
        <Icon name="add" color={C.accent} size={18} />
        <Text style={{ color: C.ink, fontSize: 13 }}>{footerAction.label}</Text>
      </Pressable>}
    </View>}
  </View>;
}
