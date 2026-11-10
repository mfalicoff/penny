import { Keypad, AmountEntry } from "@penny/ios-kit";

export const UnderAmount = () => (
  <div style={{ width: 390, background: "var(--pk-surface)", borderRadius: 24, overflow: "hidden" }}>
    <AmountEntry value="74.4" />
    <div style={{ height: 12 }} />
    <Keypad />
  </div>
);
