import { GlassButton } from "@penny/ios-kit";

const Glow = ({ children }: { children: React.ReactNode }) => (
  <div style={{ position: "relative", width: 402, padding: 18, overflow: "hidden", background: "var(--pk-bg)" }}>
    <div style={{ position: "absolute", inset: -40, background: "var(--pk-glow-copper)", filter: "blur(30px)" }} />
    <div style={{ position: "relative", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>{children}</div>
  </div>
);
export const Toolbar = () => (
  <Glow>
    <GlassButton icon="chevron-back" ariaLabel="Back" />
    <GlassButton label="November" icon="chevron-down" iconEnd />
    <GlassButton icon="calendar" ariaLabel="Calendar" />
    <GlassButton icon="settings" ariaLabel="Settings" />
  </Glow>
);
export const Primary = () => (
  <Glow>
    <GlassButton icon="checkmark" tinted ariaLabel="Save" />
    <GlassButton label="Add entry" icon="add" tinted />
    <GlassButton icon="add" tinted large ariaLabel="Add entry" />
  </Glow>
);
export const SheetAndStates = () => (
  <Glow>
    <GlassButton icon="close" plain ariaLabel="Close" />
    <GlassButton label="Edit" icon="create" />
    <GlassButton icon="trash" destructive ariaLabel="Delete" />
    <GlassButton icon="checkmark" tinted disabled ariaLabel="Save" />
  </Glow>
);
