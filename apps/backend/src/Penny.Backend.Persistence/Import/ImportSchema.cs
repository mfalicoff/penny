using NpgsqlTypes;

namespace Penny.Backend.Persistence.Import;

internal static class ImportSchema
{
    public static readonly (
        string Table,
        string Name,
        bool Unique,
        string[] Columns,
        string? Predicate
    )[] Indexes =
    [
        (
            "household_member_periods",
            "household_member_period_lookup",
            false,
            ["household_id", "user_id", "joined_at", "left_at"],
            null
        ),
        (
            "household_expenses",
            "household_recurring_occurrence",
            true,
            ["recurring_id", "expense_date"],
            "recurring_id IS NOT NULL"
        ),
        (
            "household_expenses",
            "household_expenses_month",
            false,
            ["household_id", "expense_date"],
            "deleted_at IS NULL"
        ),
        (
            "household_reimbursements",
            "household_reimbursements_month",
            false,
            ["household_id", "month"],
            null
        ),
        (
            "household_reimbursements",
            "household_expense_payment",
            true,
            ["expense_id", "from_user_id"],
            "expense_id IS NOT NULL"
        ),
    ];

    public static readonly ImportTable[] Tables =
    [
        new(
            "users",
            [
                new("id", NpgsqlDbType.Text, false),
                new("email", NpgsqlDbType.Text, false),
                new("password", NpgsqlDbType.Text, false),
                new("salt", NpgsqlDbType.Text, false),
            ],
            ["id"]
        ),
        new(
            "oidc_identities",
            [
                new("issuer", NpgsqlDbType.Text, false),
                new("subject", NpgsqlDbType.Text, false),
                new("user_id", NpgsqlDbType.Text, false),
            ],
            ["issuer", "subject"]
        ),
        new(
            "sessions",
            [
                new("token_hash", NpgsqlDbType.Text, false),
                new("user_id", NpgsqlDbType.Text, false),
                new("expires", NpgsqlDbType.Bigint, false),
            ],
            ["token_hash"]
        ),
        new(
            "ledgers",
            [
                new("user_id", NpgsqlDbType.Text, false),
                new("revision", NpgsqlDbType.Bigint, false),
                new("data", NpgsqlDbType.Jsonb, false),
            ],
            ["user_id"]
        ),
        new(
            "receipts",
            [
                new("id", NpgsqlDbType.Text, false),
                new("user_id", NpgsqlDbType.Text, false),
                new("name", NpgsqlDbType.Text, false),
                new("mime", NpgsqlDbType.Text, false),
                new("data", NpgsqlDbType.Bytea, false),
            ],
            ["id"]
        ),
        new(
            "households",
            [
                new("id", NpgsqlDbType.Text, false),
                new("name", NpgsqlDbType.Text, false),
                new("currency", NpgsqlDbType.Text, false),
                new("creator_id", NpgsqlDbType.Text, false),
                new("created_at", NpgsqlDbType.Bigint, false),
                new("archived_at", NpgsqlDbType.Bigint, true),
            ],
            ["id"]
        ),
        new(
            "household_trips",
            [
                new("household_id", NpgsqlDbType.Text, false),
                new("start_date", NpgsqlDbType.Date, false),
                new("end_date", NpgsqlDbType.Date, false),
            ],
            ["household_id"]
        ),
        new(
            "household_members",
            [
                new("household_id", NpgsqlDbType.Text, false),
                new("user_id", NpgsqlDbType.Text, false),
                new("joined_at", NpgsqlDbType.Bigint, false),
                new("left_at", NpgsqlDbType.Bigint, true),
            ],
            ["household_id", "user_id"]
        ),
        new(
            "household_member_periods",
            [
                new("id", NpgsqlDbType.Text, false),
                new("household_id", NpgsqlDbType.Text, false),
                new("user_id", NpgsqlDbType.Text, false),
                new("joined_at", NpgsqlDbType.Bigint, false),
                new("joined_on", NpgsqlDbType.Date, true),
                new("left_at", NpgsqlDbType.Bigint, true),
            ],
            ["id"]
        ),
        new(
            "household_invites",
            [
                new("code_hash", NpgsqlDbType.Text, false),
                new("household_id", NpgsqlDbType.Text, false),
                new("expires_at", NpgsqlDbType.Bigint, false),
                new("used_at", NpgsqlDbType.Bigint, true),
            ],
            ["code_hash"]
        ),
        new(
            "household_expenses",
            [
                new("id", NpgsqlDbType.Text, false),
                new("household_id", NpgsqlDbType.Text, false),
                new("title", NpgsqlDbType.Text, false),
                new("total_cents", NpgsqlDbType.Bigint, false),
                new("expense_date", NpgsqlDbType.Date, false),
                new("payer_id", NpgsqlDbType.Text, false),
                new("split_mode", NpgsqlDbType.Text, false),
                new("category", NpgsqlDbType.Jsonb, false),
                new("note", NpgsqlDbType.Text, false),
                new("account_id", NpgsqlDbType.Text, true),
                new("receipt_id", NpgsqlDbType.Text, true),
                new("revision", NpgsqlDbType.Bigint, false),
                new("created_by", NpgsqlDbType.Text, false),
                new("created_at", NpgsqlDbType.Bigint, false),
                new("updated_by", NpgsqlDbType.Text, false),
                new("updated_at", NpgsqlDbType.Bigint, false),
                new("deleted_at", NpgsqlDbType.Bigint, true),
                new("recurring_id", NpgsqlDbType.Text, true),
            ],
            ["id"]
        ),
        new(
            "household_splits",
            [
                new("expense_id", NpgsqlDbType.Text, false),
                new("user_id", NpgsqlDbType.Text, false),
                new("amount_cents", NpgsqlDbType.Bigint, false),
            ],
            ["expense_id", "user_id"]
        ),
        new(
            "household_reimbursements",
            [
                new("id", NpgsqlDbType.Text, false),
                new("household_id", NpgsqlDbType.Text, false),
                new("month", NpgsqlDbType.Text, false),
                new("from_user_id", NpgsqlDbType.Text, false),
                new("to_user_id", NpgsqlDbType.Text, false),
                new("amount_cents", NpgsqlDbType.Bigint, false),
                new("created_by", NpgsqlDbType.Text, false),
                new("created_at", NpgsqlDbType.Bigint, false),
                new("expense_id", NpgsqlDbType.Text, true),
            ],
            ["id"]
        ),
        new(
            "household_audit",
            [
                new("id", NpgsqlDbType.Text, false),
                new("household_id", NpgsqlDbType.Text, false),
                new("expense_id", NpgsqlDbType.Text, true),
                new("actor_id", NpgsqlDbType.Text, false),
                new("action", NpgsqlDbType.Text, false),
                new("before_json", NpgsqlDbType.Jsonb, true),
                new("after_json", NpgsqlDbType.Jsonb, true),
                new("created_at", NpgsqlDbType.Bigint, false),
            ],
            ["id"]
        ),
        new(
            "household_recurring",
            [
                new("id", NpgsqlDbType.Text, false),
                new("household_id", NpgsqlDbType.Text, false),
                new("title", NpgsqlDbType.Text, false),
                new("total_cents", NpgsqlDbType.Bigint, false),
                new("payer_id", NpgsqlDbType.Text, false),
                new("split_mode", NpgsqlDbType.Text, false),
                new("allocations_json", NpgsqlDbType.Jsonb, true),
                new("category", NpgsqlDbType.Jsonb, false),
                new("note", NpgsqlDbType.Text, false),
                new("account_id", NpgsqlDbType.Text, true),
                new("receipt_id", NpgsqlDbType.Text, true),
                new("frequency", NpgsqlDbType.Text, false),
                new("next_date", NpgsqlDbType.Date, false),
                new("anchor_day", NpgsqlDbType.Bigint, false),
                new("active", NpgsqlDbType.Boolean, false),
                new("created_by", NpgsqlDbType.Text, false),
                new("revision", NpgsqlDbType.Bigint, false),
            ],
            ["id"]
        ),
        new(
            "push_devices",
            [
                new("token", NpgsqlDbType.Text, false),
                new("user_id", NpgsqlDbType.Text, false),
                new("session_hash", NpgsqlDbType.Text, false),
                new("platform", NpgsqlDbType.Text, false),
                new("updated_at", NpgsqlDbType.Bigint, false),
            ],
            ["token"]
        ),
        new(
            "push_outbox",
            [
                new("id", NpgsqlDbType.Text, false),
                new("user_id", NpgsqlDbType.Text, false),
                new("household_id", NpgsqlDbType.Text, false),
                new("event_type", NpgsqlDbType.Text, false),
                new("entity_id", NpgsqlDbType.Text, false),
                new("payload", NpgsqlDbType.Jsonb, false),
                new("created_at", NpgsqlDbType.Bigint, false),
                new("sent_at", NpgsqlDbType.Bigint, true),
                new("attempts", NpgsqlDbType.Bigint, false),
                new("next_attempt_at", NpgsqlDbType.Bigint, false),
                new("last_error", NpgsqlDbType.Text, true),
            ],
            ["id"]
        ),
        new(
            "push_deliveries",
            [
                new("outbox_id", NpgsqlDbType.Text, false),
                new("token", NpgsqlDbType.Text, false),
                new("sent_at", NpgsqlDbType.Bigint, true),
                new("attempts", NpgsqlDbType.Bigint, false),
                new("next_attempt_at", NpgsqlDbType.Bigint, false),
                new("ticket_id", NpgsqlDbType.Text, true),
                new("receipt_checked_at", NpgsqlDbType.Bigint, true),
            ],
            ["outbox_id", "token"]
        ),
    ];
}
