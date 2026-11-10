import { FlowBar } from "@penny/ios-kit";

const w = { width: 360, padding: 16 };
export const Month = () => <div style={w}><FlowBar spent={1883.35} invested={200} left={1116.65} /></div>;
export const TightMonth = () => <div style={w}><FlowBar spent={2950} invested={0} left={250} /></div>;
export const BarOnly = () => <div style={w}><FlowBar spent={1883.35} invested={200} left={1116.65} legend={false} /></div>;
