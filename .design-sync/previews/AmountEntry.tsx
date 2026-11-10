import { AmountEntry } from "@penny/ios-kit";

const w = { width: 380, padding: 8, background: "var(--pk-surface)" };
export const Expense = () => <div style={w}><AmountEntry value="74.40" /></div>;
export const Income = () => <div style={w}><AmountEntry value="2,250.00" kind="income" editing={false} /></div>;
export const Investment = () => <div style={w}><AmountEntry value="200" kind="investment" /></div>;
