import { MoneyFlow } from "@penny/ios-kit";

const sources = [
  { id: "salary", label: "Salary", amount: 2800 },
  { id: "freelance", label: "Freelance", amount: 400, color: "color-mix(in srgb, var(--pk-income) 55%, white)" },
];
const destinations = [
  { id: "home", label: "Home", amount: 1450, color: "var(--pk-c-home)" },
  { id: "groceries", label: "Groceries", amount: 158.77, color: "var(--pk-c-groceries)" },
  { id: "transport", label: "Transport", amount: 156, color: "var(--pk-c-transport)" },
  { id: "food", label: "Food & drinks", amount: 80.6, color: "var(--pk-c-food)" },
  { id: "more", label: "2 more", amount: 37.98 },
  { id: "invested", label: "Invested", amount: 200, color: "var(--pk-invest)" },
  { id: "left", label: "Left over", amount: 1116.65, color: "var(--pk-income)" },
];
const card = { background: "var(--pk-surface)", borderRadius: 26, padding: "12px 6px 10px", display: "inline-block" };

export const Phone = () => <div style={{ padding: 16 }}><div style={card}><MoneyFlow sources={sources} destinations={destinations} /></div></div>;
export const Highlighted = () => <div style={{ padding: 16 }}><div style={card}><MoneyFlow sources={sources} destinations={destinations} highlight="home" /></div></div>;
export const Tablet = () => <div style={{ padding: 16 }}><div style={card}><MoneyFlow sources={sources} destinations={destinations} width={559} height={330} headers={false} /></div></div>;
export const Deficit = () => (
  <div style={{ padding: 16 }}><div style={card}>
    <MoneyFlow sources={[{ id: "salary", label: "Salary", amount: 2800 }, { id: "gap", label: "Beyond income", amount: 320, color: "var(--pk-c-other)" }]}
      destinations={[{ id: "home", label: "Home", amount: 1450, color: "var(--pk-c-home)" }, { id: "shopping", label: "Shopping", amount: 1170, color: "var(--pk-c-shopping)" }, { id: "food", label: "Food & drinks", amount: 300, color: "var(--pk-c-food)" }, { id: "invested", label: "Invested", amount: 200, color: "var(--pk-invest)" }]} />
  </div></div>
);
