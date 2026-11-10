import { SectionHeader } from "@penny/ios-kit";

const w = { width: 402, padding: "2px 0 10px", background: "var(--pk-bg)" };
export const WithAction = () => <div style={w}><SectionHeader title="Recent" action="See all" /></div>;
export const DayGroup = () => <div style={w}><SectionHeader small title="Friday, Nov 6" meta="−$262.00" /></div>;
export const FormSection = () => <div style={w}><SectionHeader small title="Suggested payments" /></div>;
