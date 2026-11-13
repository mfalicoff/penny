import { Toast, CategoryIcon, Icon } from "@penny/ios-kit";

const w = { width: 380, padding: 16, background: "linear-gradient(180deg, var(--pk-surface), var(--pk-bg))" };
export const ExpenseAdded = () => (
  <div style={w}><Toast leading={<CategoryIcon category="groceries" size="sm" />} title="Expense added" subtitle="Groceries · $48.90" action="Undo" /></div>
);
export const PaymentRecorded = () => (
  <div style={w}><Toast leading={<Icon name="checkmark-circle" color="var(--pk-income)" size={28} />} title="Payment recorded" subtitle="Jo → You · $61.40" /></div>
);
