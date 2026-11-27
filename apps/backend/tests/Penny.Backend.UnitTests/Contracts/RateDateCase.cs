namespace Penny.Backend.UnitTests.Contracts;

// The publication `publishedRateDate` picks for `date`; null when none applies.
public sealed record RateDateCase(
    IReadOnlyList<string> Published,
    string Date,
    RateDateResult? Expected
);
