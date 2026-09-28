import { useEffect, useState } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, View } from "react-native";
import type { Kind } from "../domain/ledger";
import { C, Icon } from "../shared/ui";

export function SaveToast({ message, kind }: { message: string; kind?: Kind | null }) {
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== "web",
    });
    animation.start();
    return () => animation.stop();
  }, [progress]);

  const color = kind === "expense" ? "#B94E43" : kind === "income" ? "#347B53" : kind === "investment" ? C.blue : "#B4D7B6";
  const backgroundColor = kind === "expense" ? "#FBE9E6" : kind === "income" ? "#E8F4EA" : kind === "investment" ? "#EAF1F8" : C.ink;
  const icon = kind === "expense" ? "arrow-down" : kind === "income" ? "arrow-up" : kind === "investment" ? "trending-up-outline" : "checkmark-circle";

  return <Animated.View accessibilityRole="alert" style={[styles.toast, {
    backgroundColor,
    borderColor: kind ? color : C.ink,
    opacity: progress,
    transform: [
      { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
      { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
    ],
  }]}>
    <Animated.View style={{ transform: [{ scale: progress.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.6, 1.14, 1] }) }] }}>
      <View style={[styles.icon, { backgroundColor: kind ? "#FFFFFF" : "transparent" }]}>
        <Icon name={icon} color={color} size={19} />
      </View>
    </Animated.View>
    <Text style={{ color: kind ? C.ink : "white", fontSize: 13, fontWeight: "600" }}>{message}</Text>
  </Animated.View>;
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    bottom: 86,
    alignSelf: "center",
    zIndex: 30,
    elevation: 30,
    maxWidth: "90%",
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    alignItems: "center",
    boxShadow: "0px 8px 30px #24362A20",
  },
  icon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
});
