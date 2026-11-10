import { Pill, PillGroup } from "@penny/ios-kit";

const w = { width: 402, padding: 16 };
export const Filters = () => (
  <div style={w}><PillGroup><Pill label="All" selected /><Pill label="Expenses" /><Pill label="Income" /><Pill label="Investments" /></PillGroup></div>
);
export const Categories = () => (
  <div style={w}><PillGroup nowrap>
    <Pill label="Food" icon="cafe" selected color="var(--pk-c-food)" />
    <Pill label="Groceries" icon="basket" />
    <Pill label="" icon="ellipsis-horizontal" />
  </PillGroup></div>
);
export const Removable = () => (
  <div style={w}><PillGroup><Pill label="Expenses" selected removable /><Pill label="November" icon="calendar" selected removable /></PillGroup></div>
);
