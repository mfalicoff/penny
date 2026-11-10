import { Dialog, Kbd, WebButton, SegmentedControl, AmountEntry, TextField, ListRow, List, Icon, Button } from "@penny/ios-kit";

export const NewEntry = () => (
  <div style={{ padding: 24, background: "var(--pk-dim)" }}>
    <Dialog title="New entry" width={700}
      headerExtra={<div style={{ width: 260 }}><SegmentedControl options={["Expense", "Income", "Invest"]} value="Expense" /></div>}
      hint={<><Kbd>Tab</Kbd> next field · <Kbd>⌘↵</Kbd> save · <Kbd>Esc</Kbd> cancel</>}
      actions={<><WebButton>Cancel</WebButton><WebButton primary shortcut="⌘↵">Add expense</WebButton></>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div><AmountEntry value="74.40" /><TextField value="Dinner with friends" /></div>
        <List inset={false}>
          <ListRow compact leading={<Icon name="calendar" color="var(--pk-label-2)" />} title="Date" value="Today, Nov 9" />
          <ListRow compact leading={<Icon name="card" color="var(--pk-label-2)" />} title="Account" value="Visa" />
          <ListRow compact leading={<Icon name="people" color="var(--pk-label-2)" />} title="Split" value="3 people" />
        </List>
      </div>
    </Dialog>
  </div>
);

export const Confirm = () => (
  <div style={{ padding: 24, background: "var(--pk-dim)" }}>
    <Dialog title="Delete “Rent” for everyone?" width={440}
      actions={<><WebButton>Cancel</WebButton><div style={{ width: 170 }}><Button small variant="destructive">Delete for everyone</Button></div></>}>
      <p style={{ margin: 0, fontSize: 14, color: "var(--pk-label-2)" }}>This expense is shared with Mira and Jo. Deleting it removes it for them too and recalculates November balances.</p>
    </Dialog>
  </div>
);
