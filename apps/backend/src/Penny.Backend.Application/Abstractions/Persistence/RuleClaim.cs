namespace Penny.Backend.Application.Abstractions.Persistence;

// A due rule leased to one runner pass; NextDate is the first occurrence it owes.
public sealed record RuleClaim(string RuleId, string HouseholdId, DateOnly NextDate);
