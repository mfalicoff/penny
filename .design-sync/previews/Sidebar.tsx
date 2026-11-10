import { Sidebar } from "@penny/ios-kit";

const sections = [
  { items: [{ key: "home", label: "Home", icon: "home" as const }, { key: "activity", label: "Activity", icon: "list" as const }, { key: "insights", label: "Insights", icon: "pie-chart" as const }] },
  { heading: "Together", items: [{ key: "apartment", label: "Apartment", icon: "people" as const, badge: "$142" }, { key: "lisbon", label: "Lisbon trip", icon: "airplane" as const, badge: "3" }] },
  { heading: "Manage", items: [{ key: "recurring", label: "Recurring", icon: "repeat" as const }, { key: "accounts", label: "Accounts", icon: "wallet" as const }, { key: "categories", label: "Categories", icon: "pricetag" as const }] },
];
const user = { initials: "MF", name: "Max", status: "Synced just now" };
const Frame = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: "flex", height: 640, padding: 10, background: "var(--pk-bg)" }}>{children}</div>
);
export const Home = () => <Frame><Sidebar active="home" sections={sections} user={user} /></Frame>;
export const Household = () => <Frame><Sidebar active="apartment" sections={sections} user={user} /></Frame>;
