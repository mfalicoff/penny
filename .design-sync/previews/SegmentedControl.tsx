import { SegmentedControl } from "@penny/ios-kit";

const w = { width: 370, padding: 16, display: "flex", flexDirection: "column" as const, gap: 12 };
export const EntryType = () => <div style={w}><SegmentedControl options={["Expense", "Income", "Invest"]} value="Expense" /></div>;
export const HouseholdTabs = () => <div style={w}><SegmentedControl options={["Expenses", "Balances", "People"]} value="Balances" /></div>;
export const SplitModes = () => <div style={w}><SegmentedControl options={["All mine", "Equally", "Amount", "Percent"]} value="Equally" /></div>;
