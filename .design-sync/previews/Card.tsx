import { Card, FlowBar, Stat } from "@penny/ios-kit";

export const Solid = () => (
  <div style={{ width: 402, padding: "16px 0", background: "var(--pk-bg)" }}>
    <Card>
      <div style={{ display: "flex", gap: 22 }}><Stat label="Came in" value={3200} /><Stat label="Went out" value={2083.35} /><Stat label="Left over" value={1116.65} /></div>
    </Card>
  </div>
);

export const GlassOverGlow = () => (
  <div style={{ position: "relative", width: 402, padding: "24px 0", overflow: "hidden", background: "var(--pk-bg)" }}>
    <div style={{ position: "absolute", inset: -40, background: "var(--pk-glow-copper)", filter: "blur(30px)" }} />
    <div style={{ position: "relative" }}><Card glass><FlowBar spent={1883.35} invested={200} left={1116.65} /></Card></div>
  </div>
);
