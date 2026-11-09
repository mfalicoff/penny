namespace Penny.Backend.UnitTests.Contracts;

public sealed record RecurrenceFixture(
    string Generator,
    string Description,
    IReadOnlyList<RecurrenceCase> Next,
    IReadOnlyList<RecurrenceSequence> Sequences
);
