namespace Penny.Backend.Application.Abstractions.Persistence;

// A shared recurring rule (`household_recurring` with its allocations). `LeaseToken`
// names the runner that currently owns it, if any.
public sealed record StoredRule(
    string Id,
    string HouseholdId,
    RuleRecord Values,
    string CreatedBy,
    long Revision,
    string? LeaseToken
);
