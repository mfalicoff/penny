import { Stat } from "@penny/ios-kit";

export const MoneyFlowTotals = () => (
  <div style={{ display: "flex", gap: 22, padding: 16 }}>
    <Stat label="Came in" value={3200} /><Stat label="Went out" value={2083.35} /><Stat label="Left over" value={1116.65} />
  </div>
);
export const TripTotals = () => (
  <div style={{ display: "flex", gap: 32, padding: 16 }}>
    <Stat label="Trip total" value={1284.3} /><Stat label="Your share" value={412.6} />
  </div>
);
