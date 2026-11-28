using Penny.Backend.Domain.Households;

namespace Penny.Backend.UnitTests.Contracts;

// One `settleIn` call: a month's balances shown from the household's currency in another
// at one rate, with the result or the error.
public sealed record SettleInCase(
    string Name,
    IReadOnlyList<MemberBalance> Balances,
    string From,
    string To,
    string Rate,
    SettledIn? Expected = null,
    string? Error = null
);
