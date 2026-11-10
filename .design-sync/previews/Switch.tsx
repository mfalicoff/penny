import { Switch } from "@penny/ios-kit";

const row = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", width: 340, background: "var(--pk-surface)", fontSize: 16 };
export const OnOff = () => (
  <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 1 }}>
    <div style={{ ...row, borderRadius: "16px 16px 0 0" }}>Require Face ID<Switch checked ariaLabel="Require Face ID" /></div>
    <div style={{ ...row, borderRadius: "0 0 16px 16px" }}>Share with others<Switch checked={false} ariaLabel="Share with others" /></div>
  </div>
);
