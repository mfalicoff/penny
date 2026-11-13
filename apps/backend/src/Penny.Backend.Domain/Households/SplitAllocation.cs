namespace Penny.Backend.Domain.Households;

// One requested allocation: exact cents (`AmountCents`) or a percentage in basis
// points (`PercentBasisPoints`, 10000 = 100%). Exactly one of the two is set.
public sealed record SplitAllocation(string UserId, long? AmountCents, long? PercentBasisPoints);
