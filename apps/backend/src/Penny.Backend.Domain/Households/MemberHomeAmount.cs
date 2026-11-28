namespace Penny.Backend.Domain.Households;

// A shared expense's total and a member's share in that member's home currency
// (`memberAmounts`), in its integer minor units.
public sealed record MemberHomeAmount(long TotalCents, long ShareCents);
