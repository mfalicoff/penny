import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
export const C = {
  bg: "#F8F8F4",
  paper: "#FFFFFF",
  ink: "#283B33",
  muted: "#839087",
  line: "#E9EDE7",
  accent: "#D96B42",
  orangeBg: "#FBEEE6",
  green: "#528768",
  blue: "#678DB1",
  pale: "#EDF3EC",
};
export const Icon = ({
  name,
  size = 20,
  color = C.ink,
}: {
  name: string;
  size?: number;
  color?: string;
}) => <Ionicons name={name as any} size={size} color={color} />;
export function Button({
  title,
  onPress,
  icon,
  tone = "primary",
  disabled = false,
  style,
}: {
  title: string;
  onPress: () => void;
  icon?: string;
  tone?: "primary" | "quiet" | "danger";
  disabled?: boolean;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        tone === "primary"
          ? s.primary
          : tone === "danger"
            ? { backgroundColor: "#FBEAE7" }
            : s.quiet,
        style,
        { opacity: disabled ? 0.45 : pressed ? 0.7 : 1 },
      ]}
    >
      {icon && (
        <Icon
          name={icon}
          size={18}
          color={
            tone === "primary" ? "#fff" : tone === "danger" ? "#B45343" : C.ink
          }
        />
      )}
      <Text
        style={[
          s.buttonText,
          {
            color:
              tone === "primary"
                ? "#fff"
                : tone === "danger"
                  ? "#B45343"
                  : C.ink,
          },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}
export function IconButton({
  icon,
  label,
  onPress,
}: {
  icon: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [s.iconButton, { opacity: pressed ? 0.5 : 1 }]}
    >
      <Icon name={icon} size={21} />
    </Pressable>
  );
}
export function Field({
  label,
  style,
  ...props
}: TextInputProps & { label: string; }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#A5ACA6"
        {...props}
        style={[s.input, style]}
      />
    </View>
  );
}
export function Sheet({
  visible,
  title,
  children,
  onClose,
  wide = false,
  footer,
  headerActions,
}: {
  visible: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  footer?: React.ReactNode;
  headerActions?: React.ReactNode;
}) {
  const { width } = useWindowDimensions();
  const narrowHeader = width < 360;
  const hasHeaderActions = headerActions != null;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={s.backdrop}
      >
        <View
          accessibilityViewIsModal
          style={[s.sheet, { maxWidth: wide ? 780 : 520 }]}
        >
          <View style={[s.sheetHeader, hasHeaderActions ? {
            paddingHorizontal: narrowHeader ? 8 : 12, gap: narrowHeader ? 2 : 3,
            zIndex: 20, elevation: 20,
          } : undefined]}>
            <Text numberOfLines={hasHeaderActions ? 1 : undefined}
              style={[s.sheetTitle, { flexShrink: 1 }, hasHeaderActions ? { fontSize: narrowHeader ? 14 : 18, flex: 1, minWidth: 0 } : undefined]}>{title}</Text>
            {hasHeaderActions && <View style={[s.row, { gap: narrowHeader ? 2 : 3 }]}>{headerActions}</View>}
            {hasHeaderActions ? <Pressable accessibilityRole="button" accessibilityLabel="Close dialog"
              onPress={onClose} style={{ width: narrowHeader ? 32 : 36, height: 36, alignItems: "center", justifyContent: "center" }}>
              <Icon name="close" size={21} />
            </Pressable> : <IconButton icon="close" label="Close dialog" onPress={onClose} />}
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 26, paddingTop: 8, gap: 22 }}
          >
            {children}
          </ScrollView>
          {footer && (
            <View
              style={{
                padding: 20,
                paddingTop: 14,
                borderTopWidth: 1,
                borderColor: C.line,
                gap: 10,
              }}
            >
              {footer}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
export function Tag({
  text,
  color = C.muted,
}: {
  text: string;
  color?: string;
}) {
  return (
    <View
      style={{
        backgroundColor: `${color}13`,
        borderRadius: 6,
        paddingHorizontal: 7,
        paddingVertical: 4,
      }}
    >
      <Text style={{ fontSize: 10, fontWeight: "600", color }}>{text}</Text>
    </View>
  );
}
export const s = StyleSheet.create({
  button: {
    minHeight: 44,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  primary: { backgroundColor: C.accent },
  quiet: { backgroundColor: C.pale },
  buttonText: { fontSize: 13, fontWeight: "600" },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: "#FBFCF9",
    borderRadius: 12,
    minHeight: 48,
    padding: 13,
    color: C.ink,
    fontSize: 15,
    ...(Platform.OS === "web" ? ({ outlineColor: C.accent } as any) : {}),
  },
  label: { color: C.ink, fontSize: 12, fontWeight: "600" },
  backdrop: {
    flex: 1,
    backgroundColor: "#21332960",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  sheet: {
    backgroundColor: C.paper,
    width: "100%",
    maxHeight: "92%",
    borderRadius: 24,
    overflow: "hidden",
    boxShadow: "0px 20px 80px #1C302B20",
  },
  sheetHeader: {
    padding: 24,
    paddingBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  sheetTitle: {
    fontSize: 22,
    color: C.ink,
    fontWeight: "600",
    letterSpacing: -0.6,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  between: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  muted: { fontSize: 13, color: C.muted, lineHeight: 21 },
  heading: {
    fontSize: 18,
    fontWeight: "600",
    color: C.ink,
    letterSpacing: -0.3,
  },
  card: {
    backgroundColor: C.paper,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.line,
    padding: 24,
  },
  chip: {
    borderWidth: 1,
    borderColor: C.line,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  chipActive: { borderColor: C.accent, backgroundColor: C.orangeBg },
  error: {
    color: "#B45343",
    fontSize: 13,
    lineHeight: 20,
    backgroundColor: "#FFF1ED",
    padding: 12,
    borderRadius: 10,
  },
});
