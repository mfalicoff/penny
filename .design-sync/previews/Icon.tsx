import { Icon } from "@penny/ios-kit";

const names = ["home", "list", "people", "airplane", "add", "close", "checkmark", "chevron-back", "chevron-forward", "calendar",
  "settings", "search", "options", "trash", "create", "repeat", "wallet", "card", "receipt", "cloud-offline", "alert-circle",
  "lock-closed", "finger-print", "pie-chart"] as const;

export const Common = () => (
  <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 64px)", gap: 8, padding: 16 }}>
    {names.map((n) => (
      <div key={n} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, fontSize: 10, color: "var(--pk-label-2)" }}>
        <Icon name={n} size={24} color="var(--pk-label)" />{n}
      </div>
    ))}
  </div>
);

export const Tinted = () => (
  <div style={{ display: "flex", gap: 18, padding: 16, alignItems: "center" }}>
    <Icon name="add" size={28} color="var(--pk-tint)" weight={44} />
    <Icon name="arrow-down" size={24} color="var(--pk-income)" />
    <Icon name="trending-up" size={24} color="var(--pk-invest)" />
    <Icon name="time" size={24} color="var(--pk-pending)" />
    <Icon name="alert-circle" size={24} color="var(--pk-danger)" />
  </div>
);
