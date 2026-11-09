namespace Penny.Backend.UnitTests.Contracts;

public sealed record RecurrenceSequence(
    DateOnly Start,
    string Frequency,
    int AnchorDay,
    IReadOnlyList<DateOnly> Dates
);
