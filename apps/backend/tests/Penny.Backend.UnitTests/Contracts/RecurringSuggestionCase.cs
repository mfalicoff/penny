namespace Penny.Backend.UnitTests.Contracts;

// One suggestion as the TypeScript rule produces it. Optional members are absent from
// the fixture, never null.
public sealed record RecurringSuggestionCase(
    string Id,
    string Kind,
    string Key,
    string Frequency,
    string Title,
    long Total,
    long Share,
    string CategoryId,
    int AnchorDay,
    DateOnly NextDate,
    int Count,
    DateOnly FirstDate,
    DateOnly LastDate,
    IReadOnlyList<string> EntryIds,
    int? Participants = null,
    string? AccountId = null,
    long? PreviousShare = null
);
