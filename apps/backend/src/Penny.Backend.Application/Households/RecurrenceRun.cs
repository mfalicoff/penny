namespace Penny.Backend.Application.Households;

// The outcome of one runner pass: rules leased, occurrences recorded, and the
// exception type of every rule that failed (kept leased until the lease expires, then
// retried). No ids, amounts or text, so it can be logged.
public sealed record RecurrenceRun(int Claimed, int Recorded, IReadOnlyList<string> Failures);
