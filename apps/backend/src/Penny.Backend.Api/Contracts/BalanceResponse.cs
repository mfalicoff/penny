namespace Penny.Backend.Api.Contracts;

// Contract schema `Balance`: positive when the household owes the member.
public sealed record BalanceResponse(string UserId, long BalanceCents);
