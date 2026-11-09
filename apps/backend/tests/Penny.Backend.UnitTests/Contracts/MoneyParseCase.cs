namespace Penny.Backend.UnitTests.Contracts;

// Client amount entry; exactly one of Cents or Error is present.
public sealed record MoneyParseCase(string Input, long? Cents = null, string? Error = null);
