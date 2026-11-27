namespace Penny.Backend.Domain.Ledgers;

// What a transaction paid in another currency carries (contract 2.4.0, MAZ-151): the
// amount in integer minor units of `OriginalCurrency`, the canonical rate (home units per
// unit of that currency), its status and, unless the rate is edited, the publication it
// comes from. The entry's `Total` is `OriginalAmount × Rate`, rounded once, half up.
public sealed record ForeignAmount(
    long OriginalAmount,
    string OriginalCurrency,
    string Rate,
    string RateStatus,
    DateOnly? RateDate
);
