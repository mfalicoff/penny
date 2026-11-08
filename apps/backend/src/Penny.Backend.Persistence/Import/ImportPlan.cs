using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Import;

// Target rows derived from a sealed source, except receipts, which are streamed and
// encrypted while writing so their bytes are never all held in memory.
internal sealed class ImportPlan
{
    public List<User> Users { get; } = [];
    public List<OidcIdentity> OidcIdentities { get; } = [];
    public List<Session> Sessions { get; } = [];
    public List<Household> Households { get; } = [];
    public List<HouseholdMemberPeriod> MemberPeriods { get; } = [];
    public List<HouseholdInvite> Invites { get; } = [];
    public List<Ledger> Ledgers { get; } = [];
    public List<LedgerAccount> Accounts { get; } = [];
    public List<LedgerCategory> Categories { get; } = [];
    public List<LedgerTrip> Trips { get; } = [];
    public List<LedgerRecurring> LedgerRecurring { get; } = [];
    public List<LedgerEntry> Entries { get; } = [];
    public List<HouseholdRecurring> HouseholdRecurring { get; } = [];
    public List<HouseholdRecurringAllocation> Allocations { get; } = [];
    public List<HouseholdExpense> Expenses { get; } = [];
    public List<HouseholdSplit> Splits { get; } = [];
    public List<HouseholdReimbursement> Reimbursements { get; } = [];
    public List<HouseholdAuditEntry> Audit { get; } = [];
    public List<PushDevice> PushDevices { get; } = [];
    public List<PushOutboxMessage> PushOutbox { get; } = [];
    public List<PushDelivery> PushDeliveries { get; } = [];
}
