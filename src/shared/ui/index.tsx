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
import { C, getTheme, type ThemeColors } from "../theme";
import { GlassSurface } from "./GlassSurface";
import { useAppLock } from "../../providers/AppLockProvider";
export { C } from "../theme";
export const Icon = ({
  name,
  size = 20,
  color,
}: {
  name: string;
  size?: number;
  color?: string;
}) => {
  return <Ionicons name={name as any} size={size} color={color ?? C.ink} />;
};
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
            ? { backgroundColor: C.dangerBg }
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
            tone === "primary" ? C.onAccent : tone === "danger" ? C.danger : C.ink
          }
        />
      )}
      <Text
        style={[
          s.buttonText,
          {
            color:
              tone === "primary"
                ? C.onAccent
                : tone === "danger"
                  ? C.danger
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
        placeholderTextColor={C.placeholder}
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
  overlay,
}: {
  visible: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  footer?: React.ReactNode;
  headerActions?: React.ReactNode;
  overlay?: React.ReactNode;
}) {
  const { width } = useWindowDimensions();
  const appLock = useAppLock();
  const narrowHeader = width < 360;
  const hasHeaderActions = headerActions != null;
  return (
    <Modal
      visible={visible && !appLock?.obscured}
      transparent
      animationType={Platform.OS === "web" ? "fade" : "slide"}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={s.backdrop}
      >
        <GlassSurface
          accessibilityViewIsModal={!overlay}
          style={[s.sheet, { maxWidth: wide ? 780 : 520 }]}
        >
          <View style={[s.sheetHeader, width < 400 && { paddingHorizontal: 18, paddingTop: 18 }, hasHeaderActions ? {
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
            contentContainerStyle={{ padding: width < 400 ? 18 : 26, paddingTop: 8, gap: width < 400 ? 16 : 22 }}
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
        </GlassSurface>
        {overlay && <View accessibilityViewIsModal style={[StyleSheet.absoluteFill, { zIndex: 30, elevation: 30, pointerEvents: "box-none" }]}>
          {overlay}
        </View>}
      </KeyboardAvoidingView>
    </Modal>
  );
}
export function Tag({
  text,
  color,
}: {
  text: string;
  color?: string;
}) {
  const tagColor = color ?? C.muted;
  return (
    <View
      style={{
        backgroundColor: `${tagColor}13`,
        borderRadius: 6,
        paddingHorizontal: 7,
        paddingVertical: 4,
      }}
    >
      <Text style={{ fontSize: 10, fontWeight: "600", color: tagColor }}>{text}</Text>
    </View>
  );
}
const makeStyles = (C: ThemeColors) => StyleSheet.create({
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
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.input,
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
    backgroundColor: C.backdrop,
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
    boxShadow: `0px 20px 80px ${C.shadow}`,
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
    color: C.danger,
    fontSize: 13,
    lineHeight: 20,
    backgroundColor: C.dangerBg,
    padding: 12,
    borderRadius: 10,
  },
});
let cachedTheme = getTheme();
let cachedStyles = makeStyles(C);
export const s: ReturnType<typeof makeStyles> = new Proxy(cachedStyles, {
  get(_target, property) {
    if (cachedTheme !== getTheme()) {
      cachedTheme = getTheme();
      cachedStyles = makeStyles(C);
    }
    return cachedStyles[property as keyof typeof cachedStyles];
  },
});
