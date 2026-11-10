import { List, ListRow, Icon, Switch, Avatar, Badge, Money } from "@penny/ios-kit";

const w = { width: 402, padding: "16px 0", background: "var(--pk-bg)" };

export const Settings = () => (
  <div style={w}><List>
    <ListRow compact leading={<Icon name="repeat" />} title="Recurring" value="6" chevron />
    <ListRow compact leading={<Icon name="sunny" />} title="Appearance" value="System" chevron />
    <ListRow compact leading={<Icon name="finger-print" />} title="Face ID lock" trailing={<Switch checked />} />
    <ListRow compact leading={<Icon name="cash" />} title="Currency" value="CAD" />
  </List></div>
);

export const People = () => (
  <div style={w}><List>
    <ListRow leading={<Avatar initials="MF" size={36} />} title="You" subtitle="Paid $2,900 · share $1,529.40" trailing={<Money value={142.5} kind="income" />} />
    <ListRow leading={<Avatar initials="MI" size={36} />} title="Mira" subtitle="Paid $96.30" trailing={<Money value={110.4} kind="expense" />} />
    <ListRow leading={<Avatar initials="JS" size={36} />} title="Jo" subtitle="Costco run" trailing={<Badge tone="income" icon="checkmark">Settled</Badge>} />
  </List></div>
);

export const SelectedAndDestructive = () => (
  <div style={w}><List>
    <ListRow compact title="Immediately" selected trailing={<Icon name="checkmark" color="var(--pk-tint)" size={18} />} />
    <ListRow compact title="After 1 minute" />
    <ListRow compact title="Sign out" destructive />
  </List></div>
);
