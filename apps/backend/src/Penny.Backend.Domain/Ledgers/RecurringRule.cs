namespace Penny.Backend.Domain.Ledgers;

// A client-owned recurrence rule. Clients materialize due occurrences themselves
// (entry id `{rule id}:{date}`, recurringId = rule id) and advance NextDate in the
// same write; the server validates and stores the result without generating entries.
public sealed record RecurringRule(
    string Id,
    string Title,
    string Kind,
    long Total,
    long Share,
    string CategoryId,
    string? AccountId,
    DateOnly Date,
    string Note,
    string Frequency,
    DateOnly NextDate,
    int AnchorDay,
    bool Active
);
