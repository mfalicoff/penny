import { WebSidebar } from "@penny/ios-kit";

const sections = [
  { items: [{ key: "home", label: "Home", icon: "home" as const, shortcut: "G H" }, { key: "activity", label: "Activity", icon: "list" as const, shortcut: "G A" }, { key: "insights", label: "Insights", icon: "pie-chart" as const, shortcut: "G I" }] },
  { heading: "Together", items: [{ key: "apartment", label: "Apartment", icon: "people" as const, badge: "$142" }, { key: "lisbon", label: "Lisbon", icon: "airplane" as const, badge: "Nov 12" }] },
  { heading: "Manage", items: [{ key: "recurring", label: "Recurring", icon: "repeat" as const, badge: "6" }, { key: "accounts", label: "Accounts", icon: "wallet" as const }, { key: "categories", label: "Categories", icon: "pricetag" as const }] },
];
const user = { initials: "MF", name: "Max Falicoff", status: "Synced just now" };
const Frame = ({ children }: { children: React.ReactNode }) => <div style={{ display: "flex", height: 700, background: "var(--pk-bg)" }}>{children}</div>;
export const Home = () => <Frame><WebSidebar active="home" sections={sections} user={user} /></Frame>;
export const Household = () => <Frame><WebSidebar active="apartment" sections={sections} user={user} /></Frame>;
