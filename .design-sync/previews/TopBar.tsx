import { TopBar, WebButton } from "@penny/ios-kit";

const w = { width: 1190, paddingBottom: 18, background: "var(--pk-bg)", borderBottom: "1px solid var(--pk-separator)" };
export const Variants = () => (
  <div style={{ padding: 16 }}>
    <div style={w}><TopBar title="Activity" month="November 2026" /></div>
    <div style={w}><TopBar title="Apartment" back month="November 2026" search={false} primary="Shared expense" primaryShortcut=""
      actions={<><WebButton icon="time" ariaLabel="History" /><WebButton icon="person-add">Invite</WebButton></>} /></div>
    <div style={{ ...w, borderBottom: 0 }}><TopBar title="Trips" /></div>
  </div>
);
