import { Sheet, SegmentedControl, AmountEntry, TextField, PillGroup, Pill, List, ListRow, Icon, Button } from "@penny/ios-kit";

const Backdrop = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 402, paddingTop: 60, background: "var(--pk-dim)" }}>{children}</div>
);
export const AddExpense = () => (
  <Backdrop>
    <Sheet confirm center={<SegmentedControl options={["Expense", "Income", "Invest"]} value="Expense" />}>
      <AmountEntry value="74.40" />
      <div style={{ height: 12 }} />
      <TextField value="Dinner with friends" />
      <div style={{ height: 12 }} />
      <PillGroup nowrap><Pill label="Food" icon="cafe" selected color="var(--pk-c-food)" /><Pill label="Groceries" icon="basket" /><Pill label="Transport" icon="bus" /></PillGroup>
      <div style={{ height: 12 }} />
      <div style={{ margin: "0 -16px" }}><List>
        <ListRow compact leading={<Icon name="calendar" color="var(--pk-label-2)" />} title="Date" value="Today" />
        <ListRow compact leading={<Icon name="card" color="var(--pk-label-2)" />} title="Account" value="Visa" />
        <ListRow compact leading={<Icon name="people" color="var(--pk-label-2)" />} title="Split" value="3 ways · $24.80 yours" />
      </List></div>
    </Sheet>
  </Backdrop>
);
export const RecordPayment = () => (
  <Backdrop>
    <Sheet title="Record payment" subtitle="Apartment">
      <div style={{ textAlign: "center", padding: "10px 0 16px" }}>
        <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: "-0.04em" }}>$61.40</div>
        <div style={{ fontSize: 14, color: "var(--pk-label-2)" }}>Jo's share of Costco run · Nov 4</div>
      </div>
      <p style={{ fontSize: 13, color: "var(--pk-label-2)", margin: "0 4px 14px" }}>Penny keeps track — it doesn't send money, and nobody's spending changes.</p>
      <Button icon="checkmark">Mark $61.40 as paid</Button>
    </Sheet>
  </Backdrop>
);
