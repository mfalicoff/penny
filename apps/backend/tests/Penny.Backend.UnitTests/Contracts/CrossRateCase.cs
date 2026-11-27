namespace Penny.Backend.UnitTests.Contracts;

// One unit of the first currency in the second, both quoted per base; null rounds to zero.
public sealed record CrossRateCase(string FromPerBase, string ToPerBase, string? Rate);
