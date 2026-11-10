import { Button } from "@penny/ios-kit";

const col = { display: "flex", flexDirection: "column" as const, gap: 10, width: 320, padding: 16 };

export const Primary = () => (
  <div style={col}>
    <Button>Create household</Button>
    <Button icon="checkmark">Mark $61.40 as paid</Button>
  </div>
);

export const Variants = () => (
  <div style={col}>
    <Button variant="primary">Sync, then sign out</Button>
    <Button variant="secondary">Cancel</Button>
    <Button variant="destructive">Delete for everyone</Button>
    <Button variant="quiet">Check again</Button>
  </div>
);

export const Small = () => (
  <div style={{ display: "flex", gap: 10, padding: 16, alignItems: "center" }}>
    <Button small>Try again</Button>
    <Button small variant="secondary" icon="copy">Copy</Button>
    <Button small variant="secondary">Clear filters</Button>
  </div>
);

export const Disabled = () => (
  <div style={col}>
    <Button disabled>Record paid</Button>
  </div>
);
