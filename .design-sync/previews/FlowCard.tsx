import { FlowCard, Pill } from "@penny/ios-kit";

const Glow = ({ children }: { children: React.ReactNode }) => (
  <div style={{ position: "relative", width: 402, padding: "24px 0", overflow: "hidden", background: "var(--pk-bg)" }}>
    <div style={{ position: "absolute", inset: -40, background: "var(--pk-glow-copper)", filter: "blur(30px)" }} />
    <div style={{ position: "relative" }}>{children}</div>
  </div>
);
export const Home = () => (
  <Glow><FlowCard spent={1883.35} invested={200} left={1116.65} action={<Pill label="Insights" icon="pie-chart" />} /></Glow>
);
export const NoAction = () => <Glow><FlowCard spent={1883.35} invested={200} left={1116.65} /></Glow>;
