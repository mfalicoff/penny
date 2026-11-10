import { AvatarStack } from "@penny/ios-kit";

export const Household = () => (
  <div style={{ padding: 16, display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--pk-label-2)" }}>
    <AvatarStack people={["MF", "MI", "JS"]} />3 members
  </div>
);

export const Large = () => (
  <div style={{ padding: 16 }}><AvatarStack people={["MF", "MI", "SK", "AL"]} size={44} /></div>
);
