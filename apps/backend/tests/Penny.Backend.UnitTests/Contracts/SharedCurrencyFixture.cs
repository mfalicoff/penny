using System.Text.Json;

namespace Penny.Backend.UnitTests.Contracts;

// contracts/fixtures/shared-currency.json (MAZ-151 phase 2). `projection` joins shared
// rows into the personal view (`ledgerWithHouseholds`), a client rule: it is decoded as
// raw JSON and checked by the TypeScript and Swift suites only.
public sealed record SharedCurrencyFixture(
    string Generator,
    string Description,
    IReadOnlyList<MemberAmountsCase> MemberAmounts,
    IReadOnlyList<SettleInCase> SettleIn,
    IReadOnlyList<SharedExpenseCurrencyCase> Expenses,
    JsonElement Projection
);
