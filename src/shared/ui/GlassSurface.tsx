import { BlurTargetView, BlurView } from "expo-blur";
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Platform, StyleSheet, View, type ViewProps } from "react-native";
import { C, useTheme } from "../theme";

const GlassContext = createContext<{
  target: React.RefObject<View | null>;
  reduceTransparency: boolean;
} | null>(null);

export function GlassProvider({ children }: { children: React.ReactNode }) {
  const target = useRef<View>(null);
  // Stay opaque until the accessibility preference is known.
  const [reduceTransparency, setReduceTransparency] = useState(Platform.OS === "ios");
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    let active = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener("reduceTransparencyChanged", (enabled) => {
      changed = true;
      setReduceTransparency(enabled);
    });
    void AccessibilityInfo.isReduceTransparencyEnabled().then((enabled) => {
      if (active && !changed) setReduceTransparency(enabled);
    }).catch(() => { /* Keep the accessible opaque surface if the query fails. */ });
    return () => { active = false; subscription.remove(); };
  }, []);
  return <GlassContext.Provider value={{ target, reduceTransparency }}>{children}</GlassContext.Provider>;
}

// The sampled content must exclude glass overlays to avoid recursive Android blur.
export function GlassTarget(props: ViewProps) {
  const context = useContext(GlassContext);
  return <BlurTargetView ref={context?.target} {...props} />;
}

export function GlassSurface({ style, children, ...props }: ViewProps) {
  const theme = useTheme();
  const context = useContext(GlassContext);
  const opaque = context?.reduceTransparency !== false || theme === "amoled";
  const colorScheme = theme === "light" ? "light" : "dark";
  const containerStyle = [style, styles.surface, { borderColor: C.line }];

  if (opaque || (Platform.OS === "android" && (Number(Platform.Version) < 31 || !context?.target))) {
    return <View {...props} style={[containerStyle, { backgroundColor: C.chrome }]}>{children}</View>;
  }
  if (Platform.OS === "ios" && isGlassEffectAPIAvailable() && isLiquidGlassAvailable()) {
    return <GlassView {...props} glassEffectStyle="regular" colorScheme={colorScheme}
      tintColor={`${C.chrome}26`} style={[containerStyle, styles.transparent]}>{children}</GlassView>;
  }
  return <BlurView {...props} blurTarget={context?.target} blurMethod="dimezisBlurViewSdk31Plus"
    tint={colorScheme} intensity={70} style={[containerStyle, styles.transparent]}>
    {/* Tint above the sampled image keeps contrast stable across theme changes. */}
    <View style={[StyleSheet.absoluteFill, { backgroundColor: `${C.chrome}B3`, pointerEvents: "none" }]} />
    {children}
  </BlurView>;
}

const styles = StyleSheet.create({
  surface: { overflow: "hidden", borderWidth: StyleSheet.hairlineWidth },
  transparent: { backgroundColor: "transparent" },
});
