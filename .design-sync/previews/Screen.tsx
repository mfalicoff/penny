import { Screen, Toolbar, GlassButton, HeroAmount, FlowCard, Pill, SectionHeader, List, TransactionRow, TabBar } from "@penny/ios-kit";

export const Home = () => (
  <div style={{ padding: 18 }}>
    <Screen glow="copper" bottom={<TabBar active="home" />}>
      <Toolbar leading={<GlassButton label="November" icon="chevron-down" iconEnd />}
        trailing={<><GlassButton icon="calendar" ariaLabel="Calendar" /><GlassButton icon="settings" ariaLabel="Settings" /></>} />
      <div style={{ height: 12 }} />
      <HeroAmount label="Left to spend" value={1116.65} sub={<><b>$3,366.65</b> projected with expected pay</>} subPending />
      <div style={{ height: 24 }} />
      <FlowCard spent={1883.35} invested={200} left={1116.65} action={<Pill label="Insights" icon="pie-chart" />} />
      <SectionHeader title="Recent" action="See all" />
      <List>
        <TransactionRow category="groceries" title="Groceries" meta="Today · Main chequing" amount={48.9} />
        <TransactionRow category="food" title="Coffee with Mira" meta="Today · split 2 ways" amount={6.4} />
        <TransactionRow title="TFSA contribution" meta="Nov 6 · Main chequing" amount={200} kind="investment" />
        <TransactionRow category="transport" title="Transit pass" meta="Nov 6 · Visa" amount={62} />
      </List>
    </Screen>
  </div>
);
