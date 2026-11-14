using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Api.Contracts;

// A v4 ledger in the contract key order. Reads and writes always return version 4.
public sealed record LedgerResponse(
    int Version,
    string Currency,
    IReadOnlyList<AccountResponse> Accounts,
    IReadOnlyList<TripResponse> Trips,
    IReadOnlyList<CategoryResponse> Categories,
    IReadOnlyList<EntryResponse> Transactions,
    IReadOnlyList<RecurringResponse> Recurring
)
{
    public static LedgerResponse From(LedgerDocument ledger) =>
        new(
            LedgerDocument.Version,
            ledger.Currency,
            [.. ledger.Accounts.Select(AccountResponse.From)],
            [.. ledger.Trips.Select(TripResponse.From)],
            [.. ledger.Categories.Select(CategoryResponse.From)],
            [.. ledger.Transactions.Select(EntryResponse.From)],
            [.. ledger.Recurring.Select(RecurringResponse.From)]
        );
}
