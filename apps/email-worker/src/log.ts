// The only log line the Worker writes: a fixed outcome code and, for Penny's answers,
// the HTTP status. Never addresses, subjects, senders or content.
export type Outcome =
  | "forwarded"
  | "rejected_address"
  | "rejected_unknown"
  | "rejected_size"
  | "rejected_limit"
  | "retry_list"
  | "retry_penny";

export function logOutcome(outcome: Outcome, status?: number): void {
  console.log(JSON.stringify(status === undefined ? { outcome } : { outcome, status }));
}
