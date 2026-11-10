import { Badge } from "@penny/ios-kit";

export const Tones = () => (
  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: 16, width: 360 }}>
    <Badge tone="income" icon="checkmark">Settled</Badge>
    <Badge tone="pending" icon="time">Settles Nov 30</Badge>
    <Badge tone="pending">Waiting to sync</Badge>
    <Badge tone="danger" icon="alert-circle">Overdue</Badge>
    <Badge tone="investment">Contribution</Badge>
    <Badge tone="neutral" icon="pause">Paused · monthly</Badge>
    <Badge tone="neutral">Personal</Badge>
  </div>
);
