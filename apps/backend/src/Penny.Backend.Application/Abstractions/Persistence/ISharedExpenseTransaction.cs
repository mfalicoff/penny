namespace Penny.Backend.Application.Abstractions.Persistence;

// Shared-expense operations inside one household unit of work. Writers follow the
// household lock order: every household they touch (`LockAsync`, ascending id), then
// the payer's `ledgers` row (`LockLedgerAccountAsync`), then expenses, splits and
// reimbursements. Membership writers take the same household lock, so an expense
// change and a leave, removal or archive of the same household serialize.
public interface ISharedExpenseTransaction : IHouseholdTransaction
{
    // Every membership period of the household (current, former and rejoined).
    Task<IReadOnlyList<StoredPeriod>> PeriodsAsync(string householdId);

    // Ids of the household's current members, ordered by id (ordinal).
    Task<IReadOnlyList<string>> CurrentMemberIdsAsync(string householdId);

    // Locks the user's `ledgers` row (the row PUT /api/ledger compare-and-increments)
    // and reports whether their ledger has the payment account. A concurrent ledger
    // save that deletes the account either commits first (false) or waits and then
    // sees the expense that links it (ledger check 6).
    Task<bool> LockLedgerAccountAsync(string userId, string accountId);

    Task<bool> ReceiptOwnedAsync(string userId, string receiptId);

    // Whether a live expense of the household links the receipt.
    Task<bool> ReceiptLinkedAsync(string householdId, string receiptId);

    // A live (not deleted) expense of the household.
    Task<StoredExpense?> FindExpenseAsync(string householdId, string expenseId);

    // Live expenses of the household, optionally of one month (`YYYY-MM`), newest
    // date first, then newest creation, then id.
    Task<IReadOnlyList<StoredExpense>> ListExpensesAsync(string householdId, string? month);

    Task AddExpenseAsync(
        string expenseId,
        ExpenseRecord record,
        string actorId,
        DateTimeOffset now
    );

    // Compare-and-increment on the live expense in `householdId` at `revision`, then
    // replaces its splits (`record.HouseholdId` may move it). False when nothing
    // matched (stale revision, deleted or moved).
    Task<bool> UpdateExpenseAsync(
        string householdId,
        string expenseId,
        long revision,
        ExpenseRecord record,
        string actorId,
        DateTimeOffset now
    );

    // Soft delete with compare-and-increment; splits and payments stay for history.
    Task<bool> DeleteExpenseAsync(
        string householdId,
        string expenseId,
        long revision,
        string actorId,
        DateTimeOffset now
    );

    // Records an individual payment and compare-and-increments the expense revision.
    Task<bool> AddPaymentAsync(StoredReimbursement payment, long revision);

    Task AddOutboxAsync(IReadOnlyList<StoredOutboxMessage> messages);

    // Live expenses in which the user has a share, in households they have ever
    // joined, dated within [from, to], newest date first.
    Task<IReadOnlyList<StoredProjectedExpense>> ProjectionAsync(
        string userId,
        DateOnly? from,
        DateOnly? to
    );

    // Active rules due on or before `lastDate` in unarchived households where the user
    // is a current member, ordered by next date, then id.
    Task<IReadOnlyList<StoredSharedRule>> ScheduledRulesAsync(string userId, DateOnly lastDate);

    // Dates within [from, to] for which the rule already recorded an occurrence,
    // including soft-deleted ones (a deleted occurrence stays consumed).
    Task<IReadOnlySet<DateOnly>> OccurrenceDatesAsync(string ruleId, DateOnly from, DateOnly to);
}
