namespace Penny.Backend.Domain.Ledgers;

// A validated version 4 personal ledger.
public sealed record LedgerDocument(
    string Currency,
    IReadOnlyList<PaymentAccount> Accounts,
    IReadOnlyList<Trip> Trips,
    IReadOnlyList<Category> Categories,
    IReadOnlyList<Entry> Transactions,
    IReadOnlyList<RecurringRule> Recurring
)
{
    public const int Version = 4;
}
