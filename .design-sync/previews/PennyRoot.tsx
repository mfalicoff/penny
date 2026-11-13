import { PennyRoot, HeroAmount, List, TransactionRow } from "@penny/ios-kit";

const Sample = () => (
  <div style={{ width: 360, padding: "20px 0" }}>
    <HeroAmount label="Left to spend" value={1116.65} size="compact" />
    <div style={{ height: 16 }} />
    <List>
      <TransactionRow category="groceries" title="Groceries" meta="Today · Main chequing" amount={48.9} />
      <TransactionRow category="salary" title="Payday" meta="Nov 1 · Main chequing" amount={3200} kind="income" />
    </List>
  </div>
);

export const Light = () => <PennyRoot theme="light"><Sample /></PennyRoot>;
export const Dark = () => <PennyRoot theme="dark"><Sample /></PennyRoot>;
