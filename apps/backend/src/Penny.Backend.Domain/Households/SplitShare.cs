namespace Penny.Backend.Domain.Households;

// One member's share of a shared expense, in integer cents.
public sealed record SplitShare(string UserId, long AmountCents);
