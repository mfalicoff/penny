namespace Penny.Backend.UnitTests.Contracts;

public sealed record MoneyFixture(
    string Generator,
    string Description,
    IReadOnlyList<MoneyParseCase> Parse,
    IReadOnlyList<PersonalShareCase> PersonalShares,
    IReadOnlyList<LedgerAmountCase> LedgerAmounts
);
