namespace Penny.Backend.Application.Households;

// One shared amount to show in a viewer's home currency: the expense (or scheduled
// occurrence) in its household's currency, what was paid when that was another currency,
// and the viewer's share.
public sealed record HomeRequest(
    string HouseholdCurrency,
    DateOnly Date,
    long TotalCents,
    long? OriginalAmount,
    string? OriginalCurrency,
    long ShareCents
);
