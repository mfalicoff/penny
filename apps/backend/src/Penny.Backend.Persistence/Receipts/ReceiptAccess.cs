using System.Linq.Expressions;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Receipts;

// Who may read a receipt (legacy `canReadReceipt`, docs/migration/receipts.md#access):
// its uploader, or another user when a live shared expense links it and they are a
// current member of that expense's household, or a former member with a share in it.
// One rule for downloads and for receipt text search (MAZ-125), evaluated in SQL in the
// same statement that uses it, so a membership change is honoured from its commit.
internal static class ReceiptAccess
{
    public static Expression<Func<Receipt, bool>> Readable(PennyDbContext context, string userId) =>
        receipt =>
            receipt.UserId == userId
            || context.HouseholdExpenses.Any(expense =>
                expense.ReceiptId == receipt.Id
                && expense.DeletedAt == null
                && (
                    context.HouseholdMemberPeriods.Any(period =>
                        period.HouseholdId == expense.HouseholdId
                        && period.UserId == userId
                        && period.LeftAt == null
                    )
                    || (
                        context.HouseholdSplits.Any(share =>
                            share.ExpenseId == expense.Id && share.UserId == userId
                        )
                        && context.HouseholdMemberPeriods.Any(period =>
                            period.HouseholdId == expense.HouseholdId && period.UserId == userId
                        )
                    )
                )
            );
}
