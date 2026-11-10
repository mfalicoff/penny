import { WebButton } from "@penny/ios-kit";

const row = { display: "flex", gap: 10, alignItems: "center", padding: 16, background: "var(--pk-bg)" };
export const Variants = () => (
  <div style={row}>
    <WebButton primary icon="add" shortcut="N">Add entry</WebButton>
    <WebButton icon="person-add">Invite</WebButton>
    <WebButton>Cancel</WebButton>
    <WebButton icon="time" ariaLabel="History" />
    <WebButton icon="chevron-back" ariaLabel="Back" />
  </div>
);
