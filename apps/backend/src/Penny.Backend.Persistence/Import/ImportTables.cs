namespace Penny.Backend.Persistence.Import;

// Insert order respects foreign keys. Receipts are written separately, after sessions.
internal static class ImportTables
{
    public static readonly IImportTableSpec[] BeforeReceipts =
    [
        new ImportTableSpec<Schema.Entities.User>(plan => plan.Users),
        new ImportTableSpec<Schema.Entities.OidcIdentity>(plan => plan.OidcIdentities),
        new ImportTableSpec<Schema.Entities.Session>(plan => plan.Sessions),
    ];

    public static readonly IImportTableSpec[] AfterReceipts =
    [
        new ImportTableSpec<Schema.Entities.Household>(plan => plan.Households),
        new ImportTableSpec<Schema.Entities.HouseholdMemberPeriod>(plan => plan.MemberPeriods),
        new ImportTableSpec<Schema.Entities.HouseholdInvite>(plan => plan.Invites),
        new ImportTableSpec<Schema.Entities.Ledger>(plan => plan.Ledgers),
        new ImportTableSpec<Schema.Entities.LedgerAccount>(plan => plan.Accounts),
        new ImportTableSpec<Schema.Entities.LedgerCategory>(plan => plan.Categories),
        new ImportTableSpec<Schema.Entities.LedgerTrip>(plan => plan.Trips),
        new ImportTableSpec<Schema.Entities.LedgerRecurring>(plan => plan.LedgerRecurring),
        new ImportTableSpec<Schema.Entities.LedgerEntry>(plan => plan.Entries),
        new ImportTableSpec<Schema.Entities.HouseholdRecurring>(plan => plan.HouseholdRecurring),
        new ImportTableSpec<Schema.Entities.HouseholdRecurringAllocation>(plan => plan.Allocations),
        new ImportTableSpec<Schema.Entities.HouseholdExpense>(plan => plan.Expenses),
        new ImportTableSpec<Schema.Entities.HouseholdSplit>(plan => plan.Splits),
        new ImportTableSpec<Schema.Entities.HouseholdReimbursement>(plan => plan.Reimbursements),
        new ImportTableSpec<Schema.Entities.HouseholdAuditEntry>(plan => plan.Audit),
        new ImportTableSpec<Schema.Entities.PushDevice>(plan => plan.PushDevices),
        new ImportTableSpec<Schema.Entities.PushOutboxMessage>(plan => plan.PushOutbox),
        new ImportTableSpec<Schema.Entities.PushDelivery>(plan => plan.PushDeliveries),
    ];
}
