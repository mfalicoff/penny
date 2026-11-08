using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Import;

// Builds target rows from a sealed source and enforces cross-row rules that the
// legacy schema could not express. Receipts are streamed separately (ReceiptRows).
internal static class LegacyTransform
{
    public static ImportPlan Build(SqliteImportSource source, CancellationToken ct)
    {
        var plan = new ImportPlan();
        foreach (var row in Rows(source, "users", ct))
            plan.Users.Add(
                new User
                {
                    Id = row.Text("id"),
                    Email = row.Text("email"),
                    Password = row.Text("password"),
                    Salt = row.Text("salt"),
                }
            );
        foreach (var row in Rows(source, "oidc_identities", ct))
            plan.OidcIdentities.Add(
                new OidcIdentity
                {
                    Issuer = row.Text("issuer"),
                    Subject = row.Text("subject"),
                    UserId = row.Text("user_id"),
                }
            );
        foreach (var row in Rows(source, "sessions", ct))
            plan.Sessions.Add(
                new Session
                {
                    TokenHash = row.Text("token_hash"),
                    UserId = row.Text("user_id"),
                    ExpiresAt = row.Time("expires"),
                }
            );
        foreach (var row in Rows(source, "ledgers", ct))
            LedgerDocumentMapper.Map(
                row.Text("user_id"),
                row.Long("revision"),
                row.Text("data"),
                plan
            );
        if (plan.Ledgers.Count != plan.Users.Count)
            throw new ImportFailure("user-without-ledger");
        AddHouseholds(source, plan, ct);
        AddMemberships(source, plan, ct);
        foreach (var row in Rows(source, "household_invites", ct))
            plan.Invites.Add(
                new HouseholdInvite
                {
                    CodeHash = row.Text("code_hash"),
                    HouseholdId = row.Text("household_id"),
                    ExpiresAt = row.Time("expires_at"),
                    UsedAt = row.OptionalTime("used_at"),
                }
            );
        AddRecurring(source, plan, ct);
        AddExpenses(source, plan, ct);
        foreach (var row in Rows(source, "household_reimbursements", ct))
            plan.Reimbursements.Add(
                new HouseholdReimbursement
                {
                    Id = row.Text("id"),
                    HouseholdId = row.Text("household_id"),
                    Month = row.Text("month"),
                    FromUserId = row.Text("from_user_id"),
                    ToUserId = row.Text("to_user_id"),
                    AmountCents = row.Long("amount_cents"),
                    ExpenseId = row.OptionalText("expense_id"),
                    CreatedBy = row.Text("created_by"),
                    CreatedAt = row.Time("created_at"),
                }
            );
        // Source rowid order becomes sort_order, preserving created_at tie-breaks.
        foreach (var row in Rows(source, "household_audit", ct, auditOrder: true))
            plan.Audit.Add(
                new HouseholdAuditEntry
                {
                    SortOrder = row.RowId,
                    Id = row.Text("id"),
                    HouseholdId = row.Text("household_id"),
                    ExpenseId = row.OptionalText("expense_id"),
                    ActorId = row.Text("actor_id"),
                    Action = row.Text("action"),
                    BeforeJson = row.OptionalText("before_json"),
                    AfterJson = row.OptionalText("after_json"),
                    CreatedAt = row.Time("created_at"),
                }
            );
        AddPush(source, plan, ct);
        return plan;
    }

    public static IEnumerable<LegacyRow> ReceiptRows(
        SqliteImportSource source,
        CancellationToken ct
    ) => Rows(source, "receipts", ct);

    private static void AddHouseholds(
        SqliteImportSource source,
        ImportPlan plan,
        CancellationToken ct
    )
    {
        var trips = Rows(source, "household_trips", ct)
            .ToDictionary(
                row => row.Text("household_id"),
                row => (Start: row.Date("start_date"), End: row.Date("end_date")),
                StringComparer.Ordinal
            );
        foreach (var row in Rows(source, "households", ct))
        {
            var id = row.Text("id");
            var trip = trips.Remove(id, out var dates) ? dates : ((DateOnly, DateOnly)?)null;
            plan.Households.Add(
                new Household
                {
                    Id = id,
                    Name = row.Text("name"),
                    Currency = row.Text("currency"),
                    CreatorId = row.Text("creator_id"),
                    CreatedAt = row.Time("created_at"),
                    ArchivedAt = row.OptionalTime("archived_at"),
                    TripStart = trip?.Item1,
                    TripEnd = trip?.Item2,
                }
            );
        }
    }

    // household_members and household_member_periods merge into periods only.
    // A member without periods (pre-period data) gets one synthesized period.
    private static void AddMemberships(
        SqliteImportSource source,
        ImportPlan plan,
        CancellationToken ct
    )
    {
        var periods = Rows(source, "household_member_periods", ct)
            .Select(row => new HouseholdMemberPeriod
            {
                Id = row.Text("id"),
                HouseholdId = row.Text("household_id"),
                UserId = row.Text("user_id"),
                JoinedAt = row.Time("joined_at"),
                JoinedOn = row.OptionalDate("joined_on"),
                LeftAt = row.OptionalTime("left_at"),
            })
            .ToLookup(period => (period.HouseholdId, period.UserId));
        var members = new HashSet<(string, string)>();
        foreach (var row in Rows(source, "household_members", ct))
        {
            var key = (row.Text("household_id"), row.Text("user_id"));
            members.Add(key);
            var current = row.OptionalLong("left_at") is null;
            var history = periods[key].ToList();
            if (history.Count == 0)
            {
                plan.MemberPeriods.Add(
                    new HouseholdMemberPeriod
                    {
                        Id = SynthesizedPeriodId(key.Item1, key.Item2),
                        HouseholdId = key.Item1,
                        UserId = key.Item2,
                        JoinedAt = row.Time("joined_at"),
                        LeftAt = row.OptionalTime("left_at"),
                    }
                );
                continue;
            }
            var open = history.Count(period => period.LeftAt is null);
            if (open > 1 || current != (open == 1))
                throw new ImportFailure("membership-mismatch");
            plan.MemberPeriods.AddRange(history);
        }
        if (periods.Any(group => !members.Contains(group.Key)))
            throw new ImportFailure("membership-mismatch");
    }

    private static void AddRecurring(
        SqliteImportSource source,
        ImportPlan plan,
        CancellationToken ct
    )
    {
        foreach (var row in Rows(source, "household_recurring", ct))
        {
            var id = row.Text("id");
            var category = Category(row.Text("category"));
            plan.HouseholdRecurring.Add(
                new HouseholdRecurring
                {
                    Id = id,
                    HouseholdId = row.Text("household_id"),
                    Title = row.Text("title"),
                    TotalCents = row.Long("total_cents"),
                    PayerId = row.Text("payer_id"),
                    SplitMode = row.Text("split_mode"),
                    CategoryName = category.Name,
                    CategoryIcon = category.Icon,
                    CategoryColor = category.Color,
                    Note = row.Text("note"),
                    AccountId = row.OptionalText("account_id"),
                    ReceiptId = row.OptionalText("receipt_id"),
                    Frequency = row.Text("frequency"),
                    NextDate = row.Date("next_date"),
                    AnchorDay = checked((short)row.Long("anchor_day")),
                    Active = row.Bool("active"),
                    CreatedBy = row.Text("created_by"),
                    Revision = row.Long("revision"),
                }
            );
            if (row.OptionalText("allocations_json") is { } allocations)
                plan.Allocations.AddRange(Allocations(id, allocations));
        }
    }

    private static void AddExpenses(
        SqliteImportSource source,
        ImportPlan plan,
        CancellationToken ct
    )
    {
        foreach (var row in Rows(source, "household_expenses", ct))
        {
            var category = Category(row.Text("category"));
            plan.Expenses.Add(
                new HouseholdExpense
                {
                    Id = row.Text("id"),
                    HouseholdId = row.Text("household_id"),
                    Title = row.Text("title"),
                    TotalCents = row.Long("total_cents"),
                    ExpenseDate = row.Date("expense_date"),
                    PayerId = row.Text("payer_id"),
                    SplitMode = row.Text("split_mode"),
                    CategoryName = category.Name,
                    CategoryIcon = category.Icon,
                    CategoryColor = category.Color,
                    Note = row.Text("note"),
                    AccountId = row.OptionalText("account_id"),
                    ReceiptId = row.OptionalText("receipt_id"),
                    RecurringId = row.OptionalText("recurring_id"),
                    Revision = row.Long("revision"),
                    CreatedBy = row.Text("created_by"),
                    CreatedAt = row.Time("created_at"),
                    UpdatedBy = row.Text("updated_by"),
                    UpdatedAt = row.Time("updated_at"),
                    DeletedAt = row.OptionalTime("deleted_at"),
                }
            );
        }
        foreach (var row in Rows(source, "household_splits", ct))
            plan.Splits.Add(
                new HouseholdSplit
                {
                    ExpenseId = row.Text("expense_id"),
                    UserId = row.Text("user_id"),
                    AmountCents = row.Long("amount_cents"),
                }
            );
        var sums = plan
            .Splits.GroupBy(split => split.ExpenseId, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.Sum(split => split.AmountCents));
        if (plan.Expenses.Any(expense => sums.GetValueOrDefault(expense.Id) != expense.TotalCents))
            throw new ImportFailure("referential-or-financial-mismatch");
    }

    private static void AddPush(SqliteImportSource source, ImportPlan plan, CancellationToken ct)
    {
        var sessions = plan.Sessions.ToDictionary(
            session => session.TokenHash,
            session => session.UserId,
            StringComparer.Ordinal
        );
        foreach (var row in Rows(source, "push_devices", ct))
        {
            var device = new PushDevice
            {
                Token = row.Text("token"),
                UserId = row.Text("user_id"),
                SessionHash = row.Text("session_hash"),
                Platform = row.Text("platform"),
                UpdatedAt = row.Time("updated_at"),
            };
            if (sessions.GetValueOrDefault(device.SessionHash) != device.UserId)
                throw new ImportFailure("referential-or-financial-mismatch");
            plan.PushDevices.Add(device);
        }
        foreach (var row in Rows(source, "push_outbox", ct))
            plan.PushOutbox.Add(
                new PushOutboxMessage
                {
                    Id = row.Text("id"),
                    UserId = row.Text("user_id"),
                    HouseholdId = row.Text("household_id"),
                    EventType = row.Text("event_type"),
                    EntityId = row.Text("entity_id"),
                    Payload = row.Text("payload"),
                    CreatedAt = row.Time("created_at"),
                    SentAt = row.OptionalTime("sent_at"),
                    Attempts = checked((int)row.Long("attempts")),
                    NextAttemptAt = row.Time("next_attempt_at"),
                    LastError = row.OptionalText("last_error"),
                }
            );
        foreach (var row in Rows(source, "push_deliveries", ct))
            plan.PushDeliveries.Add(
                new PushDelivery
                {
                    OutboxId = row.Text("outbox_id"),
                    Token = row.Text("token"),
                    SentAt = row.OptionalTime("sent_at"),
                    Attempts = checked((int)row.Long("attempts")),
                    NextAttemptAt = row.Time("next_attempt_at"),
                    TicketId = row.OptionalText("ticket_id"),
                    ReceiptCheckedAt = row.OptionalTime("receipt_checked_at"),
                }
            );
    }

    private static (string Name, string Icon, string Color) Category(string json)
    {
        using var document = JsonDocument.Parse(json);
        var value = document.RootElement;
        if (
            value.ValueKind != JsonValueKind.Object
            || value.EnumerateObject().Count() != 3
            || !value.TryGetProperty("name", out var name)
            || !value.TryGetProperty("icon", out var icon)
            || !value.TryGetProperty("color", out var color)
            || name.ValueKind != JsonValueKind.String
            || icon.ValueKind != JsonValueKind.String
            || color.ValueKind != JsonValueKind.String
        )
            throw new ImportFailure("invalid-category");
        return (name.GetString()!, icon.GetString()!, color.GetString()!);
    }

    private static IEnumerable<HouseholdRecurringAllocation> Allocations(
        string recurringId,
        string json
    )
    {
        using var document = JsonDocument.Parse(json);
        var value = document.RootElement;
        if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() > 100)
            throw new ImportFailure("invalid-allocations");
        var result = new List<HouseholdRecurringAllocation>();
        foreach (var item in value.EnumerateArray())
        {
            if (
                item.ValueKind != JsonValueKind.Object
                || item.EnumerateObject().Count() != 2
                || !item.TryGetProperty("userId", out var user)
                || user.ValueKind != JsonValueKind.String
            )
                throw new ImportFailure("invalid-allocations");
            long? amount = null;
            int? percent = null;
            if (item.TryGetProperty("amountCents", out var cents) && cents.TryGetInt64(out var a))
                amount = a;
            else if (
                item.TryGetProperty("percentBasisPoints", out var points)
                && points.TryGetInt32(out var p)
            )
                percent = p;
            else
                throw new ImportFailure("invalid-allocations");
            result.Add(
                new HouseholdRecurringAllocation
                {
                    RecurringId = recurringId,
                    UserId = user.GetString()!,
                    AmountCents = amount,
                    PercentBasisPoints = percent,
                }
            );
        }
        return result;
    }

    private static string SynthesizedPeriodId(string householdId, string userId) =>
        "legacy-member-"
        + Convert.ToHexStringLower(
            SHA256.HashData(Encoding.UTF8.GetBytes(householdId + "\0" + userId))
        )[..32];

    private static IEnumerable<LegacyRow> Rows(
        SqliteImportSource source,
        string table,
        CancellationToken ct,
        bool auditOrder = false
    )
    {
        var definition = ImportSchema.Tables.Single(t => t.Name == table);
        foreach (var values in source.ReadRows(definition, ct, auditOrder))
            yield return new LegacyRow(definition, values);
    }
}
