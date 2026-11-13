import { Money } from "@penny/ios-kit";

const row = { display: "flex", justifyContent: "space-between", padding: "8px 0", fontSize: 17, fontWeight: 600, borderBottom: "0.5px solid var(--pk-separator)" };
const lbl = { fontWeight: 400, color: "var(--pk-label-2)", fontSize: 15 };

export const Kinds = () => (
  <div style={{ width: 300, padding: 16 }}>
    <div style={row}><span style={lbl}>Expense</span><Money value={48.9} kind="expense" /></div>
    <div style={row}><span style={lbl}>Income</span><Money value={3200} kind="income" /></div>
    <div style={row}><span style={lbl}>Investment</span><Money value={200} kind="investment" /></div>
    <div style={row}><span style={lbl}>Expected pay</span><Money value={2250} kind="pending" unsigned /></div>
    <div style={row}><span style={lbl}>Share of total</span><Money value={12.8} kind="muted" /></div>
  </div>
);

export const Whole = () => (
  <div style={{ padding: 16, fontSize: 28, fontWeight: 700 }}>
    <Money value={1883.35} whole />
  </div>
);
