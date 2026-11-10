import { Avatar } from "@penny/ios-kit";

export const Sizes = () => (
  <div style={{ display: "flex", gap: 12, alignItems: "center", padding: 16 }}>
    <Avatar initials="MF" size={24} />
    <Avatar initials="MI" />
    <Avatar initials="JS" size={44} />
  </div>
);

export const InRow = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 16, width: 320, background: "var(--pk-surface)", borderRadius: 20 }}>
    <Avatar initials="MI" size={36} />
    <div><div style={{ fontWeight: 600 }}>Mira</div><div style={{ fontSize: 13, color: "var(--pk-label-2)" }}>Member · joined Sep 2</div></div>
  </div>
);
