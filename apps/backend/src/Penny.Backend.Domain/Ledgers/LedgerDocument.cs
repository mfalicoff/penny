namespace Penny.Backend.Domain.Ledgers;

// A validated version 4 personal ledger. `DismissedSuggestions` (contract 2.3.0) is
// empty when the ledger has none: the API omits it then, and an absent list reads as
// empty. The strings are opaque to the server and keep the order they were sent in.
public sealed record LedgerDocument(
    string Currency,
    IReadOnlyList<PaymentAccount> Accounts,
    IReadOnlyList<Trip> Trips,
    IReadOnlyList<Category> Categories,
    IReadOnlyList<Entry> Transactions,
    IReadOnlyList<RecurringRule> Recurring,
    IReadOnlyList<string> DismissedSuggestions
)
{
    public const int Version = 4;
}
