import { Pill, PillGroup } from "@penny/ios-kit";

export const Wrapping = () => (
  <div style={{ width: 300, padding: 16 }}>
    <PillGroup><Pill label="All" selected /><Pill label="Expenses" /><Pill label="Payments" /><Pill label="Members" /><Pill label="Recurring" /></PillGroup>
  </div>
);
export const SingleLine = () => (
  <div style={{ width: 340, padding: 16 }}>
    <PillGroup nowrap><Pill label="All" selected /><Pill label="Expenses" /><Pill label="Income" /><Pill label="Investments" /><Pill label="November" icon="calendar" /></PillGroup>
  </div>
);
