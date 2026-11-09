using Penny.Backend.Domain.Households;

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

    // Monthly settlement (MAZ-58). Reimbursement writers hold the household lock, like
    // every expense and payment writer, so balances cannot change before commit.

    // The household's reimbursements of `month` (monthly reimbursements and individual
    // expense payments), oldest first, then id.
    Task<IReadOnlyList<StoredReimbursement>> ListReimbursementsAsync(
        string householdId,
        string month
    );

    // Records a monthly reimbursement (`ExpenseId` null).
    Task AddReimbursementAsync(StoredReimbursement reimbursement);

    // The balance contributions a former member can see: live expenses in which they
    // have a share, and reimbursements recorded by the time they left or involving them.
    Task<IReadOnlyList<BalanceContribution>> VisibleBalancesAsync(
        string householdId,
        FormerMember viewer
    );

    // Audit events of the household, newest first (ties: later rows first), optionally
    // of one expense, at most `limit` when given. A former member sees only events of
    // expenses they have a share in (while the expense belongs to this household) and
    // household events recorded by the time they left.
    Task<IReadOnlyList<StoredAuditEvent>> AuditEventsAsync(
        string householdId,
        string? expenseId,
        FormerMember? viewer,
        int? limit
    );

    // Search (MAZ-121): rewrites the expense's search document from its committed-to-be
    // row (removing it once deleted) and queues its embedding when the embedded text
    // changed. Call after every expense write, before commit.
    Task IndexExpenseAsync(string expenseId);

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

    // Shared recurring rules (MAZ-59). Rule writers and the runner follow one lock
    // order: the household row, then the payer's `ledgers` row when an account is
    // validated, then the rule row (its compare-and-increment).

    // The household's rules, ordered by next date, then id.
    Task<IReadOnlyList<StoredRule>> ListRulesAsync(string householdId);

    Task<StoredRule?> FindRuleAsync(string householdId, string ruleId);

    Task AddRuleAsync(string ruleId, string householdId, RuleRecord record, string actorId);

    // Compare-and-increment on the rule at `revision`, replacing its allocations.
    // False when nothing matched (stale revision or deleted).
    Task<bool> UpdateRuleAsync(string householdId, string ruleId, long revision, RuleRecord record);

    // Deletes the rule and its allocations at `revision`; occurrences keep their
    // `recurring_id`. False when nothing matched.
    Task<bool> DeleteRuleAsync(string householdId, string ruleId, long revision);

    // Runner step: moves the rule still leased to `leaseToken` from next date `from`
    // to `to`, increments its revision and extends the lease to `leaseUntil`. The rule
    // row stays locked until commit. False when the lease was lost or the next date
    // changed; the runner then writes nothing.
    Task<bool> AdvanceRuleAsync(
        string ruleId,
        string leaseToken,
        DateOnly from,
        DateOnly to,
        DateTimeOffset leaseUntil
    );
}
