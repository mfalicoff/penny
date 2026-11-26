using System.Text.Json.Serialization;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Api.Contracts;

// A v4 ledger in the contract key order. Reads and writes always return version 4.
// `dismissedSuggestions` (contract 2.3.0) is omitted when there are none, like the
// other optional ledger data; clients treat absent and empty alike.
public sealed record LedgerResponse(
    int Version,
    string Currency,
    IReadOnlyList<AccountResponse> Accounts,
    IReadOnlyList<TripResponse> Trips,
    IReadOnlyList<CategoryResponse> Categories,
    IReadOnlyList<EntryResponse> Transactions,
    IReadOnlyList<RecurringResponse> Recurring,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        IReadOnlyList<string>? DismissedSuggestions
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
            [.. ledger.Recurring.Select(RecurringResponse.From)],
            ledger.DismissedSuggestions.Count == 0 ? null : [.. ledger.DismissedSuggestions]
        );
}
