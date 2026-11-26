namespace Penny.Backend.UnitTests.Contracts;

// contracts/fixtures/recurring-suggestions.json (contract 2.3.0). The server never runs
// the suggestion rule; it decodes the fixture and accepts every case ledger.
public sealed record RecurringSuggestionsFixture(
    string Generator,
    string Description,
    IReadOnlyList<SuggestionKeyCase> Keys,
    IReadOnlyList<RecurringSuggestionsCase> Cases
);
