import { TabBar } from "@penny/ios-kit";

const Over = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 402, padding: "18px 16px", background: "linear-gradient(180deg, var(--pk-bg), var(--pk-surface-2))" }}>{children}</div>
);
export const Home = () => <Over><TabBar active="home" /></Over>;
export const Shared = () => <Over><TabBar active="shared" /></Over>;
export const WithoutAdd = () => <Over><TabBar active="trips" showAdd={false} /></Over>;
