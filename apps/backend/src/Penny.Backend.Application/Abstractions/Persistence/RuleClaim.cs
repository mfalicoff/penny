namespace Penny.Backend.Application.Abstractions.Persistence;

// A due rule leased to one runner pass.
public sealed record RuleClaim(string RuleId, string HouseholdId);
