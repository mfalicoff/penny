import { WebFrame, WebSidebar, TopBar, HeroAmount, FlowBar, Card, DataTable, CategoryIcon, Money } from "@penny/ios-kit";

const sections = [
  { items: [{ key: "home", label: "Home", icon: "home" as const, shortcut: "G H" }, { key: "activity", label: "Activity", icon: "list" as const, shortcut: "G A" }, { key: "insights", label: "Insights", icon: "pie-chart" as const, shortcut: "G I" }] },
  { heading: "Together", items: [{ key: "apartment", label: "Apartment", icon: "people" as const, badge: "$142" }, { key: "lisbon", label: "Lisbon", icon: "airplane" as const, badge: "Nov 12" }] },
  { heading: "Manage", items: [{ key: "recurring", label: "Recurring", icon: "repeat" as const, badge: "6" }, { key: "accounts", label: "Accounts", icon: "wallet" as const }, { key: "categories", label: "Categories", icon: "pricetag" as const }] },
];
const user = { initials: "MF", name: "Max Falicoff", status: "Synced just now" };
export const Home = () => (
  <div style={{ padding: 20 }}>
    <WebFrame glow="copper" sidebar={<WebSidebar active="home" sections={sections} user={user} />}>
      <TopBar title="Home" month="November 2026" />
      <div style={{ padding: "22px 32px 0", display: "grid", gridTemplateColumns: "minmax(0,1fr) 360px", gap: 18 }}>
        <div>
          <HeroAmount label="Left to spend" value={1116.65} size="tablet" sub={<><b>$3,366.65</b> projected · includes $2,250 expected pay on Nov 15</>} subPending />
          <div style={{ marginTop: 22 }}><Card glass inset={false}><FlowBar spent={1883.35} invested={200} left={1116.65} /></Card></div>
        </div>
        <DataTable columns={[{ key: "e", label: "Recent" }, { key: "a", label: "", align: "right" }]} rows={[
          { id: "1", cells: { e: <span style={{ display: "flex", gap: 10, alignItems: "center" }}><CategoryIcon category="groceries" size="sm" />Groceries</span>, a: <Money value={48.9} kind="expense" /> } },
          { id: "2", cells: { e: <span style={{ display: "flex", gap: 10, alignItems: "center" }}><CategoryIcon category="salary" size="sm" />Payday</span>, a: <Money value={3200} kind="income" /> } },
        ]} />
      </div>
    </WebFrame>
  </div>
);
