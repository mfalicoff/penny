import { List, ListRow, TransactionRow, CategoryIcon, Icon } from "@penny/ios-kit";

const w = { width: 402, padding: "16px 0", background: "var(--pk-bg)" };

export const Transactions = () => (
  <div style={w}><List>
    <TransactionRow category="salary" title="Payday" meta="Nov 1 · Main chequing" amount={3200} kind="income" />
    <TransactionRow category="home" title="Rent" meta="Apartment · you paid $2,900" amount={1450} note="your share" />
    <TransactionRow category="groceries" title="Groceries" meta="Today · Main chequing" amount={48.9} />
  </List></div>
);

export const Accounts = () => (
  <div style={w}><List>
    <ListRow leading={<Icon name="wallet" />} title="Main chequing" subtitle="Bank account · 42 entries, 2 schedules" chevron />
    <ListRow leading={<Icon name="card" />} title="Visa" subtitle="Credit card · 31 entries, 3 schedules" chevron />
    <ListRow leading={<Icon name="cash" />} title="Wallet" subtitle="Cash · 3 entries" chevron />
  </List></div>
);

export const Categories = () => (
  <div style={w}><List>
    <ListRow leading={<CategoryIcon category="home" />} title="Home" subtitle="14 entries" trailing={<Icon name="list" color="var(--pk-label-3)" />} />
    <ListRow leading={<CategoryIcon category="groceries" />} title="Groceries" subtitle="38 entries" trailing={<Icon name="list" color="var(--pk-label-3)" />} />
  </List></div>
);
