import { List, SectionHeader, TransactionRow } from "@penny/ios-kit";

const wrap = { width: 402, padding: "4px 0 16px", background: "var(--pk-bg)" };

export const DayGroup = () => (
  <div style={wrap}>
    <SectionHeader small title="Today" meta="−$55.30" />
    <List>
      <TransactionRow category="groceries" title="Groceries" meta="Today · Main chequing" amount={48.9} />
      <TransactionRow category="food" title="Coffee with Mira" meta="Today · Visa · split 2 ways" amount={6.4} note="of $12.80" />
    </List>
  </div>
);

export const Kinds = () => (
  <div style={wrap}>
    <List>
      <TransactionRow category="salary" title="Payday" meta="Nov 1 · Main chequing" amount={3200} kind="income" />
      <TransactionRow title="TFSA contribution" meta="Nov 6 · Main chequing · monthly" amount={200} kind="investment" />
      <TransactionRow category="home" title="Rent" meta="Apartment · you paid $2,900" amount={1450} note="your share" />
      <TransactionRow category="transport" title="Transit pass" meta="Nov 6 · Visa" amount={62} />
    </List>
  </div>
);

export const Selected = () => (
  <div style={{ ...wrap, width: 380 }}>
    <List>
      <TransactionRow category="groceries" title="Groceries" meta="Main chequing" amount={48.9} />
      <TransactionRow category="food" title="Coffee with Mira" meta="Visa · split 2 ways" amount={6.4} selected />
    </List>
  </div>
);
