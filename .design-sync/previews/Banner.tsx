import { Banner, Button } from "@penny/ios-kit";

const w = { width: 380, padding: 16, display: "flex", flexDirection: "column" as const, gap: 10, background: "linear-gradient(180deg, #fbe7dc, var(--pk-bg))" };
export const Offline = () => (
  <div style={w}><Banner tone="offline" title="Offline" message="2 changes waiting to sync" action={<Button small variant="quiet">Retry</Button>} /></div>
);
export const SaveError = () => (
  <div style={w}><Banner tone="error" title="Couldn't save" message="The server didn't respond. Your draft is kept." action={<Button small>Try again</Button>} /></div>
);
export const ExpectedPay = () => (
  <div style={w}><Banner tone="info" title="Counts toward Projected" message="Nov 15 is still ahead, so this pay is expected until it's recorded." /></div>
);
