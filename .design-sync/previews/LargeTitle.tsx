import { LargeTitle } from "@penny/ios-kit";

const w = { width: 402, padding: "12px 0", background: "var(--pk-bg)" };
export const Activity = () => <div style={w}><LargeTitle title="Activity" /></div>;
export const WithSubtitle = () => <div style={w}><LargeTitle title="Money flow" subtitle="From coming in to going out" /></div>;
