namespace Penny.Backend.Domain.Households;

// A member's net balance in one month, in integer cents. Positive means the household
// owes the member; negative means the member owes the household.
public sealed record MemberBalance(string UserId, long BalanceCents);
