namespace Penny.Backend.UnitTests.Contracts;

public sealed record RecurrenceCase(DateOnly Date, string Frequency, int AnchorDay, DateOnly Next);
