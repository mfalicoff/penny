namespace Penny.Backend.UnitTests.Contracts;

// `amount` minor units of `from` at `rate`, converted into `home` minor units.
public sealed record CurrencyConversionCase(
    long Amount,
    string From,
    string Rate,
    string Home,
    long Converted
);
