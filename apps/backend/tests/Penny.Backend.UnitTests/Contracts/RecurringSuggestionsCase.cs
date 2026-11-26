using System.Text.Json;

namespace Penny.Backend.UnitTests.Contracts;

// A v4 ledger (kept as JSON to run through LedgerReader), the day and the suggestions
// the clients offer for it.
public sealed record RecurringSuggestionsCase(
    string Name,
    DateOnly Today,
    JsonElement Ledger,
    IReadOnlyList<RecurringSuggestionCase> Expected
);
