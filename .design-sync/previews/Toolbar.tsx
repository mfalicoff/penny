import { Toolbar, GlassButton } from "@penny/ios-kit";

const Glow = ({ children }: { children: React.ReactNode }) => (
  <div style={{ position: "relative", width: 402, padding: "10px 0", overflow: "hidden", background: "var(--pk-bg)" }}>
    <div style={{ position: "absolute", inset: -40, background: "var(--pk-glow-copper)", filter: "blur(30px)" }} />
    <div style={{ position: "relative" }}>{children}</div>
  </div>
);

export const MonthPicker = () => (
  <Glow><Toolbar leading={<GlassButton label="November" icon="chevron-down" iconEnd />}
    trailing={<><GlassButton icon="calendar" ariaLabel="Calendar" /><GlassButton icon="settings" ariaLabel="Settings" /></>} /></Glow>
);

export const Pushed = () => (
  <Glow><Toolbar leading={<GlassButton icon="chevron-back" ariaLabel="Back" />}
    trailing={<><GlassButton icon="person-add" ariaLabel="Invite" /><GlassButton icon="ellipsis-horizontal" ariaLabel="More" /></>} /></Glow>
);

export const WithTitle = () => (
  <Glow><Toolbar title="Appearance" leading={<GlassButton icon="chevron-back" ariaLabel="Back" />} trailing={<span style={{ width: 44 }} />} /></Glow>
);
