// Dark-appearance tokens from contracts/design-baseline.json (docs/design/penny-ios/assets/penny.css).
import { hex } from "../splats/random.ts";

export const palette = {
  copper: hex("#E4572E"),
  copperDark: hex("#FF6F3F"),
  copperIcon: hex("#D96B3C"),
  copperText: hex("#FF8A5E"),
  cream: hex("#F4EBDD"),
  ink: hex("#2A2420"),
  income: hex("#3DD07A"),
  invest: hex("#8E8BFF"),
  pending: hex("#E0A040"),
  danger: hex("#FF6B60"),
  home: hex("#3B82F6"),
  groceries: hex("#0FA3A3"),
  food: hex("#E0529C"),
  transport: hex("#8796AD"),
  shopping: hex("#A0704C"),
  graphite: hex("#2C2A28"),
  surface: hex("#1A1918"),
  surface2: hex("#232220"),
  label: hex("#F6F4F1"),
  label2: hex("#A39E97"),
  glow1: hex("#FF8A4C"),
  glow2: hex("#FFC478"),
  glow3: hex("#FF7896"),
} as const;
