namespace Penny.Backend.UnitTests.Contracts;

// The fields of a shared expense that `memberAmounts` reads.
public sealed record MemberAmountsExpense(
    long TotalCents,
    long? OriginalAmount = null,
    string? OriginalCurrency = null
);
