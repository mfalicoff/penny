namespace Penny.Backend.UnitTests.Contracts;

public sealed record PersonalShareCase(
    long Total,
    string Mode,
    string Input,
    long? Share = null,
    string? Error = null
);
