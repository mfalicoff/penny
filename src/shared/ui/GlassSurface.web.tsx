import React from "react";
import { View, type ViewProps } from "react-native";

export function GlassProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function GlassTarget(props: ViewProps) {
  return <View {...props} />;
}

export function GlassSurface(props: ViewProps) {
  return <View {...props} />;
}
