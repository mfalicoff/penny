import { useWindowDimensions } from "react-native";

export function useResponsive() {
  const { width } = useWindowDimensions();
  return { compact: width < 600, desktop: width >= 1000 };
}
