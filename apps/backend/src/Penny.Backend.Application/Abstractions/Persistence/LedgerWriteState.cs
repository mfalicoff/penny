namespace Penny.Backend.Application.Abstractions.Persistence;

// Facts a ledger write is checked against, read in the saving transaction.
// OwnedReceiptIds and ExistingHouseholdIds are limited to the ids the new ledger
// references.
public sealed record LedgerWriteState(
    IReadOnlySet<string> HouseholdCurrencies,
    IReadOnlySet<string> LinkedAccountIds,
    IReadOnlySet<string> OwnedReceiptIds,
    IReadOnlySet<string> ExistingHouseholdIds
);
