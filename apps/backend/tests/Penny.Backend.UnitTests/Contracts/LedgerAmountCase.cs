namespace Penny.Backend.UnitTests.Contracts;

// Total and share may be deliberately invalid numbers (fractions, negatives).
public sealed record LedgerAmountCase(decimal Total, decimal Share, bool Valid);
