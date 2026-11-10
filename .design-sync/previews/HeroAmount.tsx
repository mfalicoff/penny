import { HeroAmount } from "@penny/ios-kit";

const glow = { position: "relative" as const, width: 402, padding: "28px 0", overflow: "hidden", background: "var(--pk-bg)" };
const bg = { position: "absolute" as const, inset: -60, background: "var(--pk-glow-copper)", filter: "blur(40px)" };

export const LeftToSpend = () => (
  <div style={glow}>
    <div style={bg} />
    <div style={{ position: "relative" }}>
      <HeroAmount label="Left to spend" value={1116.65} sub={<><b>$3,366.65</b> projected with expected pay</>} subPending />
    </div>
  </div>
);

export const YouAreOwed = () => (
  <div style={{ width: 402, padding: "24px 0", background: "var(--pk-bg)" }}>
    <HeroAmount label="November · you're owed" value={142.5} tone="income" size="compact" align="center" />
  </div>
);

export const Tablet = () => (
  <div style={{ width: 640, padding: "24px 0", background: "var(--pk-bg)" }}>
    <HeroAmount label="Left to spend" value={1116.65} size="tablet"
      sub={<><b>$3,366.65</b> projected · includes $2,250 expected pay on Nov 15</>} subPending />
  </div>
);

export const Empty = () => (
  <div style={{ width: 402, padding: "24px 0", background: "var(--pk-bg)" }}>
    <HeroAmount label="Left to spend" value={0} sub="Your month fills in as you add entries." />
  </div>
);
