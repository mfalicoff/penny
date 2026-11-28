namespace Penny.Backend.Domain.Households;

// Balances and suggested payments converted into another currency for display
// (`settleIn`).
public sealed record SettledIn(
    IReadOnlyList<MemberBalance> Balances,
    IReadOnlyList<SuggestedReimbursement> Suggestions
);
