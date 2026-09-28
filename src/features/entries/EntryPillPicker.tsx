import { useEffect, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { C, Icon, s } from "../../shared/ui";

export type PillOption = { id: string; label: string; icon?: string; color?: string; accessibilityLabel?: string };
export type PillMenuPosition = { left: number; top: number; width: number };

function menuListHeight(count: number, emptyMessage: boolean, footerAction: boolean) {
  return Math.min(footerAction ? 156 : 196, count * 44 + (emptyMessage ? 66 : 0));
}

export function EntryPillPicker({ label, value, options, open, iconOnly = false, align = "left", onToggle, onPosition, emptyMessage, hasFooterAction = false }: {
  label: string;
  value: string;
  options: PillOption[];
  open: boolean;
  align?: "left" | "center" | "right";
  iconOnly?: boolean;
  onToggle: () => void;
  onPosition: (position: PillMenuPosition) => void;
  emptyMessage?: string;
  hasFooterAction?: boolean;
}) {
  const { width, height } = useWindowDimensions();
  const anchor = useRef<View>(null);
  const triggerSize = iconOnly && width < 360 ? 30 : 34;
  const menuWidth = Math.min(iconOnly ? 230 : 250, width - (iconOnly ? 48 : 90));
  const menuHeight = 49 + menuListHeight(options.length, Boolean(emptyMessage), hasFooterAction) + (hasFooterAction ? 44 : 0);
  useEffect(() => {
    if (open) anchor.current?.measureInWindow((x, y, triggerWidth, triggerHeight) => {
      const preferredLeft = align === "right" ? x + triggerWidth - menuWidth
        : align === "center" ? x + (triggerWidth - menuWidth) / 2 : x;
      const preferredTop = height - y - triggerHeight < menuHeight + 6 && y > menuHeight + 6
        ? y - menuHeight - 6 : y + triggerHeight + 6;
      onPosition({
        left: Math.max(16, Math.min(preferredLeft, width - menuWidth - 16)),
        top: Math.max(12, Math.min(preferredTop, height - menuHeight - 12)),
        width: menuWidth,
      });
    });
  }, [open, height, width, align, menuWidth, menuHeight, onPosition]);
  const selected = options.find((option) => option.id === value);
  return <View ref={anchor}>
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
  </View>;
}

export function EntryPillMenu({ label, value, options, position, onClose, onSelect, emptyMessage, footerAction }: {
  label: string;
  value: string;
  options: PillOption[];
  position: PillMenuPosition | null;
  onClose: () => void;
  onSelect: (id: string) => void;
  emptyMessage?: string;
  footerAction?: { label: string; onPress: () => void };
}) {
  const { width } = useWindowDimensions();
  const listHeight = menuListHeight(options.length, Boolean(emptyMessage), Boolean(footerAction));
  return <View style={[StyleSheet.absoluteFill, { pointerEvents: "box-none" }]}>
    <Pressable accessibilityRole="button" accessibilityLabel="Close selection" onPress={onClose} style={StyleSheet.absoluteFill} />
    <View style={{
      position: "absolute", left: position?.left ?? 16, top: position?.top ?? 70,
      width: position?.width ?? Math.min(230, width - 48), backgroundColor: C.paper,
      borderWidth: 1, borderColor: C.line, borderRadius: 16,
      padding: 8, elevation: 12, boxShadow: "0px 12px 32px #1C302B20",
    }}>
      <Text style={[s.label, { paddingHorizontal: 10, paddingVertical: 7 }]}>Choose {label.toLowerCase()}</Text>
      <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={{ height: listHeight }}>
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
    </View>
  </View>;
}
