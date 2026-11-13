using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;
using Pgvector;

#nullable disable

namespace Penny.Backend.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InitialSchema : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(name: "penny");

            migrationBuilder
                .AlterDatabase()
                .Annotation("Npgsql:PostgresExtension:pg_trgm", ",,")
                .Annotation("Npgsql:PostgresExtension:vector", ",,");

            migrationBuilder.CreateTable(
                name: "oidc_attempts",
                schema: "penny",
                columns: table => new
                {
                    transaction_hash = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    redirect_uri = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    state = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    nonce = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    code_verifier = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    expires_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: false
                    ),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_oidc_attempts", x => x.transaction_hash);
                    table.CheckConstraint(
                        "CK_oidc_attempts_code_verifier",
                        "length(code_verifier) BETWEEN 43 AND 128"
                    );
                    table.CheckConstraint(
                        "CK_oidc_attempts_nonce",
                        "length(nonce) BETWEEN 1 AND 256"
                    );
                    table.CheckConstraint(
                        "CK_oidc_attempts_redirect_uri",
                        "length(redirect_uri) BETWEEN 1 AND 2048"
                    );
                    table.CheckConstraint(
                        "CK_oidc_attempts_state",
                        "length(state) BETWEEN 1 AND 256"
                    );
                    table.CheckConstraint(
                        "CK_oidc_attempts_transaction_hash",
                        "transaction_hash ~ '^[0-9a-f]{64}$'"
                    );
                }
            );

            migrationBuilder.CreateTable(
                name: "users",
                schema: "penny",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    email = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    password = table.Column<string>(type: "text", nullable: false, collation: "C"),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_users", x => x.id);
                }
            );

            migrationBuilder.CreateTable(
                name: "households",
                schema: "penny",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    name = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    currency = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    creator_id = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    created_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: false
                    ),
                    archived_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: true
                    ),
                    trip_start = table.Column<DateOnly>(type: "date", nullable: true),
                    trip_end = table.Column<DateOnly>(type: "date", nullable: true),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_households", x => x.id);
                    table.CheckConstraint(
                        "ck_households_currency",
                        "currency IN ('CAD','USD','EUR','GBP')"
                    );
                    table.CheckConstraint(
                        "ck_households_trip",
                        "(trip_start IS NULL) = (trip_end IS NULL) AND (trip_end IS NULL OR trip_end >= trip_start)"
                    );
                    table.ForeignKey(
                        name: "FK_households_users_creator_id",
                        column: x => x.creator_id,
                        principalSchema: "penny",
                        principalTable: "users",
                        principalColumn: "id"
                    );
                }
            );

            migrationBuilder.CreateTable(
                name: "ledgers",
                schema: "penny",
                columns: table => new
                {
                    user_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    currency = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    revision = table.Column<long>(type: "bigint", nullable: false),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ledgers", x => x.user_id);
                    table.CheckConstraint(
                        "ck_ledgers_currency",
                        "currency IN ('CAD','USD','EUR','GBP')"
                    );
                    table.CheckConstraint(
                        "ck_ledgers_revision",
                        "revision BETWEEN 0 AND 9007199254740991"
                    );
                    table.ForeignKey(
                        name: "FK_ledgers_users_user_id",
                        column: x => x.user_id,
                        principalSchema: "penny",
                        principalTable: "users",
                        principalColumn: "id"
                    );
                }
            );

            migrationBuilder.CreateTable(
                name: "oidc_identities",
                schema: "penny",
                columns: table => new
                {
                    issuer = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    subject = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    user_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_oidc_identities", x => new { x.issuer, x.subject });
                    table.ForeignKey(
                        name: "FK_oidc_identities_users_user_id",
                        column: x => x.user_id,
                        principalSchema: "penny",
                        principalTable: "users",
                        principalColumn: "id"
                    );
                }
            );

            migrationBuilder.CreateTable(
                name: "password_resets",
                schema: "penny",
                columns: table => new
                {
                    token_hash = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    user_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    created_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: false
                    ),
                    expires_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: false
                    ),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_password_resets", x => x.token_hash);
                    table.CheckConstraint("CK_password_resets_expiry", "expires_at > created_at");
                    table.CheckConstraint(
                        "CK_password_resets_token_hash",
                        "token_hash ~ '^[0-9a-f]{64}$'"
                    );
                    table.ForeignKey(
                        name: "FK_password_resets_users_user_id",
                        column: x => x.user_id,
                        principalSchema: "penny",
                        principalTable: "users",
                        principalColumn: "id"
                    );
                }
            );

            migrationBuilder.CreateTable(
                name: "receipts",
                schema: "penny",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    user_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    storage_path = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    encryption_version = table.Column<short>(
                        type: "smallint",
                        nullable: false,
                        defaultValue: (short)1
                    ),
                    key_salt = table.Column<byte[]>(type: "bytea", nullable: false),
                    file_nonce = table.Column<byte[]>(type: "bytea", nullable: false),
                    name_nonce = table.Column<byte[]>(type: "bytea", nullable: false),
                    name_encrypted = table.Column<byte[]>(type: "bytea", nullable: false),
                    mime = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    size_bytes = table.Column<long>(type: "bigint", nullable: false),
                    created_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: false
                    ),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_receipts", x => x.id);
                    table.UniqueConstraint("AK_receipts_user_id_id", x => new { x.user_id, x.id });
                    table.CheckConstraint(
                        "ck_receipts_encryption_version",
                        "encryption_version = 1"
                    );
                    table.CheckConstraint("ck_receipts_file_nonce", "length(file_nonce) = 12");
                    table.CheckConstraint("ck_receipts_key_salt", "length(key_salt) = 32");
                    table.CheckConstraint("ck_receipts_mime", "length(mime) BETWEEN 1 AND 100");
                    table.CheckConstraint("ck_receipts_name_nonce", "length(name_nonce) = 12");
                    table.CheckConstraint("ck_receipts_size", "size_bytes >= 0");
                    table.CheckConstraint(
                        "ck_receipts_storage_path",
                        "storage_path ~ '^[0-9a-f]{2}/[0-9a-f]{32}$'"
                    );
                    table.ForeignKey(
                        name: "FK_receipts_users_user_id",
                        column: x => x.user_id,
                        principalSchema: "penny",
                        principalTable: "users",
                        principalColumn: "id"
                    );
                }
            );

            migrationBuilder.CreateTable(
                name: "sessions",
                schema: "penny",
                columns: table => new
                {
                    token_hash = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    user_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    expires_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: false
                    ),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_sessions", x => x.token_hash);
                    table.ForeignKey(
                        name: "FK_sessions_users_user_id",
                        column: x => x.user_id,
                        principalSchema: "penny",
                        principalTable: "users",
                        principalColumn: "id"
                    );
                }
            );

            migrationBuilder.CreateTable(
                name: "household_audit",
                schema: "penny",
                columns: table => new
                {
                    sort_order = table
                        .Column<long>(type: "bigint", nullable: false)
                        .Annotation(
                            "Npgsql:ValueGenerationStrategy",
                            NpgsqlValueGenerationStrategy.IdentityByDefaultColumn
                        ),
                    id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    household_id = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    expense_id = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    actor_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    action = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    before_json = table.Column<string>(type: "jsonb", nullable: true),
                    after_json = table.Column<string>(type: "jsonb", nullable: true),
                    created_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: false
                    ),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_household_audit", x => x.sort_order);
                    table.ForeignKey(
                        name: "FK_household_audit_households_household_id",
                        column: x => x.household_id,
                        principalSchema: "penny",
                        principalTable: "households",
                        principalColumn: "id"
                    );
                    table.ForeignKey(
                        name: "FK_household_audit_users_actor_id",
                        column: x => x.actor_id,
                        principalSchema: "penny",
                        principalTable: "users",
                        principalColumn: "id"
                    );
                }
            );

            migrationBuilder.CreateTable(
                name: "household_invites",
                schema: "penny",
                columns: table => new
                {
                    code_hash = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    household_id = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    expires_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: false
                    ),
                    used_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: true
                    ),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_household_invites", x => x.code_hash);
                    table.ForeignKey(
                        name: "FK_household_invites_households_household_id",
                        column: x => x.household_id,
                        principalSchema: "penny",
                        principalTable: "households",
                        principalColumn: "id"
                    );
                }
            );

            migrationBuilder.CreateTable(
                name: "household_member_periods",
                schema: "penny",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    household_id = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    user_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    joined_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: false
                    ),
                    joined_on = table.Column<DateOnly>(type: "date", nullable: true),
                    left_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: true
                    ),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_household_member_periods", x => x.id);
                    table.CheckConstraint(
                        "ck_household_member_periods_order",
                        "left_at IS NULL OR left_at >= joined_at"
                    );
                    table.ForeignKey(
                        name: "FK_household_member_periods_households_household_id",
                        column: x => x.household_id,
                        principalSchema: "penny",
                        principalTable: "households",
                        principalColumn: "id"
                    );
                    table.ForeignKey(
                        name: "FK_household_member_periods_users_user_id",
                        column: x => x.user_id,
                        principalSchema: "penny",
                        principalTable: "users",
                        principalColumn: "id"
                    );
                }
            );

            migrationBuilder.CreateTable(
                name: "push_outbox",
                schema: "penny",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    user_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    household_id = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    event_type = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    entity_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    payload = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: false
                    ),
                    sent_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: true
                    ),
                    attempts = table.Column<int>(type: "integer", nullable: false),
                    next_attempt_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: false
                    ),
                    last_error = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    lease_owner = table.Column<string>(
                        type: "text",
                        nullable: true,
                        collation: "C"
                    ),
                    lease_token = table.Column<string>(
                        type: "text",
                        nullable: true,
                        collation: "C"
                    ),
                    lease_expires_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: true
                    ),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_push_outbox", x => x.id);
                    table.CheckConstraint("ck_push_outbox_attempts", "attempts >= 0");
                    table.CheckConstraint(
                        "ck_push_outbox_lease",
                        "(lease_owner IS NULL) = (lease_token IS NULL) AND (lease_token IS NULL) = (lease_expires_at IS NULL)"
                    );
                    table.ForeignKey(
                        name: "FK_push_outbox_households_household_id",
                        column: x => x.household_id,
                        principalSchema: "penny",
                        principalTable: "households",
                        principalColumn: "id"
                    );
                    table.ForeignKey(
                        name: "FK_push_outbox_users_user_id",
                        column: x => x.user_id,
                        principalSchema: "penny",
                        principalTable: "users",
                        principalColumn: "id"
                    );
                }
            );

            migrationBuilder.CreateTable(
                name: "ledger_accounts",
                schema: "penny",
                columns: table => new
                {
                    user_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    name = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    type = table.Column<string>(type: "text", nullable: false, collation: "C"),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ledger_accounts", x => new { x.user_id, x.id });
                    table.CheckConstraint("ck_ledger_accounts_id", "length(id) BETWEEN 1 AND 100");
                    table.CheckConstraint(
                        "ck_ledger_accounts_name",
                        "length(name) BETWEEN 1 AND 50"
                    );
                    table.CheckConstraint(
                        "ck_ledger_accounts_type",
                        "type IN ('bank','credit','cash','other')"
                    );
                    table.ForeignKey(
                        name: "FK_ledger_accounts_ledgers_user_id",
                        column: x => x.user_id,
                        principalSchema: "penny",
                        principalTable: "ledgers",
                        principalColumn: "user_id"
                    );
                }
            );

            migrationBuilder.CreateTable(
                name: "ledger_categories",
                schema: "penny",
                columns: table => new
                {
                    user_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    name = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    icon = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    color = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    kind = table.Column<string>(type: "text", nullable: false, collation: "C"),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ledger_categories", x => new { x.user_id, x.id });
                    table.CheckConstraint(
                        "ck_ledger_categories_color",
                        "color ~ '^#[0-9A-Fa-f]{6}$'"
                    );
                    table.CheckConstraint(
                        "ck_ledger_categories_icon",
                        "length(icon) BETWEEN 0 AND 80"
                    );
                    table.CheckConstraint(
                        "ck_ledger_categories_id",
                        "length(id) BETWEEN 1 AND 100"
                    );
                    table.CheckConstraint(
                        "ck_ledger_categories_kind",
                        "kind IN ('income','expense','investment')"
                    );
                    table.CheckConstraint(
                        "ck_ledger_categories_name",
                        "length(name) BETWEEN 0 AND 50"
                    );
                    table.ForeignKey(
                        name: "FK_ledger_categories_ledgers_user_id",
                        column: x => x.user_id,
                        principalSchema: "penny",
                        principalTable: "ledgers",
                        principalColumn: "user_id"
                    );
                }
            );

            migrationBuilder.CreateTable(
                name: "ledger_trips",
                schema: "penny",
                columns: table => new
                {
                    user_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    name = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    start_date = table.Column<DateOnly>(type: "date", nullable: false),
                    end_date = table.Column<DateOnly>(type: "date", nullable: false),
                    shared_household_id = table.Column<string>(
                        type: "text",
                        nullable: true,
                        collation: "C"
                    ),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ledger_trips", x => new { x.user_id, x.id });
                    table.CheckConstraint("ck_ledger_trips_dates", "end_date >= start_date");
                    table.CheckConstraint("ck_ledger_trips_id", "length(id) BETWEEN 1 AND 100");
                    table.CheckConstraint("ck_ledger_trips_name", "length(name) BETWEEN 1 AND 80");
                    table.ForeignKey(
                        name: "FK_ledger_trips_households_shared_household_id",
                        column: x => x.shared_household_id,
                        principalSchema: "penny",
                        principalTable: "households",
                        principalColumn: "id"
                    );
                    table.ForeignKey(
                        name: "FK_ledger_trips_ledgers_user_id",
                        column: x => x.user_id,
                        principalSchema: "penny",
                        principalTable: "ledgers",
                        principalColumn: "user_id"
                    );
                }
            );

            migrationBuilder.CreateTable(
                name: "household_expenses",
                schema: "penny",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    household_id = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    title = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    total_cents = table.Column<long>(type: "bigint", nullable: false),
                    expense_date = table.Column<DateOnly>(type: "date", nullable: false),
                    payer_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    split_mode = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    category_name = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    category_icon = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    category_color = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    note = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    account_id = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    receipt_id = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    recurring_id = table.Column<string>(
                        type: "text",
                        nullable: true,
                        collation: "C"
                    ),
                    revision = table.Column<long>(type: "bigint", nullable: false),
                    created_by = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    created_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: false
                    ),
                    updated_by = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    updated_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: false
                    ),
                    deleted_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: true
                    ),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_household_expenses", x => x.id);
                    table.CheckConstraint(
                        "ck_household_expenses_category_color",
                        "category_color ~ '^#[0-9A-Fa-f]{6}$'"
                    );
                    table.CheckConstraint(
                        "ck_household_expenses_category_icon",
                        "length(category_icon) BETWEEN 0 AND 80"
                    );
                    table.CheckConstraint(
                        "ck_household_expenses_category_name",
                        "length(category_name) BETWEEN 1 AND 50"
                    );
                    table.CheckConstraint(
                        "ck_household_expenses_note",
                        "length(note) BETWEEN 0 AND 1000"
                    );
                    table.CheckConstraint(
                        "ck_household_expenses_revision",
                        "revision BETWEEN 0 AND 9007199254740991"
                    );
                    table.CheckConstraint(
                        "ck_household_expenses_split_mode",
                        "split_mode IN ('equal','exact','percent')"
                    );
                    table.CheckConstraint(
                        "ck_household_expenses_total",
                        "total_cents BETWEEN 1 AND 99999999999"
                    );
                    table.ForeignKey(
                        name: "FK_household_expenses_households_household_id",
                        column: x => x.household_id,
                        principalSchema: "penny",
                        principalTable: "households",
                        principalColumn: "id"
                    );
                    table.ForeignKey(
                        name: "FK_household_expenses_receipts_receipt_id",
                        column: x => x.receipt_id,
                        principalSchema: "penny",
                        principalTable: "receipts",
                        principalColumn: "id"
                    );
                    table.ForeignKey(
                        name: "FK_household_expenses_users_created_by",
                        column: x => x.created_by,
                        principalSchema: "penny",
                        principalTable: "users",
                        principalColumn: "id"
                    );
                    table.ForeignKey(
                        name: "FK_household_expenses_users_payer_id",
                        column: x => x.payer_id,
                        principalSchema: "penny",
                        principalTable: "users",
                        principalColumn: "id"
                    );
                    table.ForeignKey(
                        name: "FK_household_expenses_users_updated_by",
                        column: x => x.updated_by,
                        principalSchema: "penny",
                        principalTable: "users",
                        principalColumn: "id"
                    );
                }
            );

            migrationBuilder.CreateTable(
                name: "household_recurring",
                schema: "penny",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    household_id = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    title = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    total_cents = table.Column<long>(type: "bigint", nullable: false),
                    payer_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    split_mode = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    category_name = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    category_icon = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    category_color = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    note = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    account_id = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    receipt_id = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    frequency = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    next_date = table.Column<DateOnly>(type: "date", nullable: false),
                    anchor_day = table.Column<short>(type: "smallint", nullable: false),
                    active = table.Column<bool>(type: "boolean", nullable: false),
                    created_by = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    revision = table.Column<long>(type: "bigint", nullable: false),
                    lease_owner = table.Column<string>(
                        type: "text",
                        nullable: true,
                        collation: "C"
                    ),
                    lease_token = table.Column<string>(
                        type: "text",
                        nullable: true,
                        collation: "C"
                    ),
                    lease_expires_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: true
                    ),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_household_recurring", x => x.id);
                    table.CheckConstraint(
                        "ck_household_recurring_anchor_day",
                        "anchor_day BETWEEN 1 AND 31"
                    );
                    table.CheckConstraint(
                        "ck_household_recurring_category_color",
                        "category_color ~ '^#[0-9A-Fa-f]{6}$'"
                    );
                    table.CheckConstraint(
                        "ck_household_recurring_category_icon",
                        "length(category_icon) BETWEEN 0 AND 80"
                    );
                    table.CheckConstraint(
                        "ck_household_recurring_category_name",
                        "length(category_name) BETWEEN 1 AND 50"
                    );
                    table.CheckConstraint(
                        "ck_household_recurring_frequency",
                        "frequency IN ('weekly','monthly','yearly')"
                    );
                    table.CheckConstraint(
                        "ck_household_recurring_lease",
                        "(lease_owner IS NULL) = (lease_token IS NULL) AND (lease_token IS NULL) = (lease_expires_at IS NULL)"
                    );
                    table.CheckConstraint(
                        "ck_household_recurring_note",
                        "length(note) BETWEEN 0 AND 1000"
                    );
                    table.CheckConstraint(
                        "ck_household_recurring_revision",
                        "revision BETWEEN 0 AND 9007199254740991"
                    );
                    table.CheckConstraint(
                        "ck_household_recurring_split_mode",
                        "split_mode IN ('equal','exact','percent')"
                    );
                    table.CheckConstraint(
                        "ck_household_recurring_total",
                        "total_cents BETWEEN 1 AND 99999999999"
                    );
                    table.ForeignKey(
                        name: "FK_household_recurring_households_household_id",
                        column: x => x.household_id,
                        principalSchema: "penny",
                        principalTable: "households",
                        principalColumn: "id"
                    );
                    table.ForeignKey(
                        name: "FK_household_recurring_receipts_receipt_id",
                        column: x => x.receipt_id,
                        principalSchema: "penny",
                        principalTable: "receipts",
                        principalColumn: "id"
                    );
                    table.ForeignKey(
                        name: "FK_household_recurring_users_created_by",
                        column: x => x.created_by,
                        principalSchema: "penny",
                        principalTable: "users",
                        principalColumn: "id"
                    );
                    table.ForeignKey(
                        name: "FK_household_recurring_users_payer_id",
                        column: x => x.payer_id,
                        principalSchema: "penny",
                        principalTable: "users",
                        principalColumn: "id"
                    );
                }
            );

            migrationBuilder.CreateTable(
                name: "receipt_texts",
                schema: "penny",
                columns: table => new
                {
                    receipt_id = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    status = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    method = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    engine = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    content = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    search_text = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    pages = table.Column<int>(type: "integer", nullable: true),
                    failure = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    attempts = table.Column<int>(type: "integer", nullable: false),
                    due_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: true
                    ),
                    lease_token = table.Column<string>(
                        type: "text",
                        nullable: true,
                        collation: "C"
                    ),
                    lease_expires_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: true
                    ),
                    created_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: false,
                        defaultValueSql: "now()"
                    ),
                    extracted_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: true
                    ),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_receipt_texts", x => x.receipt_id);
                    table.CheckConstraint("ck_receipt_texts_attempts", "attempts >= 0");
                    table.CheckConstraint(
                        "ck_receipt_texts_done",
                        "status <> 'done' OR method IS NOT NULL"
                    );
                    table.CheckConstraint(
                        "ck_receipt_texts_due",
                        "(status = 'pending') = (due_at IS NOT NULL)"
                    );
                    table.CheckConstraint(
                        "ck_receipt_texts_finished",
                        "status = 'pending' OR (engine IS NOT NULL AND extracted_at IS NOT NULL)"
                    );
                    table.CheckConstraint(
                        "ck_receipt_texts_lease",
                        "(lease_token IS NULL) = (lease_expires_at IS NULL)"
                    );
                    table.CheckConstraint(
                        "ck_receipt_texts_method",
                        "method IS NULL OR method IN ('text','ocr','mixed')"
                    );
                    table.CheckConstraint("ck_receipt_texts_pages", "pages IS NULL OR pages >= 0");
                    table.CheckConstraint(
                        "ck_receipt_texts_status",
                        "status IN ('pending','done','failed','unsupported')"
                    );
                    table.ForeignKey(
                        name: "FK_receipt_texts_receipts_receipt_id",
                        column: x => x.receipt_id,
                        principalSchema: "penny",
                        principalTable: "receipts",
                        principalColumn: "id"
                    );
                }
            );

            migrationBuilder.CreateTable(
                name: "push_devices",
                schema: "penny",
                columns: table => new
                {
                    token = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    user_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    session_hash = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    platform = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    provider = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    environment = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    updated_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: false
                    ),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_push_devices", x => x.token);
                    table.CheckConstraint("ck_push_devices_platform", "platform = 'ios'");
                    table.CheckConstraint(
                        "ck_push_devices_provider",
                        "provider = 'apns' AND environment IN ('sandbox','production')"
                    );
                    table.ForeignKey(
                        name: "FK_push_devices_sessions_session_hash",
                        column: x => x.session_hash,
                        principalSchema: "penny",
                        principalTable: "sessions",
                        principalColumn: "token_hash",
                        onDelete: ReferentialAction.Cascade
                    );
                    table.ForeignKey(
                        name: "FK_push_devices_users_user_id",
                        column: x => x.user_id,
                        principalSchema: "penny",
                        principalTable: "users",
                        principalColumn: "id"
                    );
                }
            );

            migrationBuilder.CreateTable(
                name: "push_deliveries",
                schema: "penny",
                columns: table => new
                {
                    outbox_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    token = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    sent_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: true
                    ),
                    attempts = table.Column<int>(type: "integer", nullable: false),
                    next_attempt_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: false
                    ),
                    ticket_id = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    last_error = table.Column<string>(type: "text", nullable: true, collation: "C"),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_push_deliveries", x => new { x.outbox_id, x.token });
                    table.CheckConstraint("ck_push_deliveries_attempts", "attempts >= 0");
                    table.ForeignKey(
                        name: "FK_push_deliveries_push_outbox_outbox_id",
                        column: x => x.outbox_id,
                        principalSchema: "penny",
                        principalTable: "push_outbox",
                        principalColumn: "id"
                    );
                }
            );

            migrationBuilder.CreateTable(
                name: "ledger_recurring",
                schema: "penny",
                columns: table => new
                {
                    user_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    title = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    kind = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    total_cents = table.Column<long>(type: "bigint", nullable: false),
                    share_cents = table.Column<long>(type: "bigint", nullable: false),
                    category_id = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    account_id = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    start_date = table.Column<DateOnly>(type: "date", nullable: false),
                    note = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    frequency = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    next_date = table.Column<DateOnly>(type: "date", nullable: false),
                    anchor_day = table.Column<short>(type: "smallint", nullable: false),
                    active = table.Column<bool>(type: "boolean", nullable: false),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ledger_recurring", x => new { x.user_id, x.id });
                    table.CheckConstraint(
                        "ck_ledger_recurring_anchor_day",
                        "anchor_day BETWEEN 1 AND 31"
                    );
                    table.CheckConstraint(
                        "ck_ledger_recurring_frequency",
                        "frequency IN ('weekly','monthly','yearly')"
                    );
                    table.CheckConstraint("ck_ledger_recurring_id", "length(id) BETWEEN 1 AND 100");
                    table.CheckConstraint(
                        "ck_ledger_recurring_kind",
                        "kind IN ('income','expense','investment')"
                    );
                    table.CheckConstraint(
                        "ck_ledger_recurring_note",
                        "length(note) BETWEEN 0 AND 1000"
                    );
                    table.CheckConstraint(
                        "ck_ledger_recurring_share",
                        "share_cents BETWEEN 0 AND total_cents"
                    );
                    table.CheckConstraint(
                        "ck_ledger_recurring_title",
                        "length(title) BETWEEN 1 AND 100"
                    );
                    table.CheckConstraint(
                        "ck_ledger_recurring_total",
                        "total_cents BETWEEN 1 AND 99999999999"
                    );
                    table.ForeignKey(
                        name: "FK_ledger_recurring_ledger_accounts_user_id_account_id",
                        columns: x => new { x.user_id, x.account_id },
                        principalSchema: "penny",
                        principalTable: "ledger_accounts",
                        principalColumns: new[] { "user_id", "id" }
                    );
                    table.ForeignKey(
                        name: "FK_ledger_recurring_ledger_categories_user_id_category_id",
                        columns: x => new { x.user_id, x.category_id },
                        principalSchema: "penny",
                        principalTable: "ledger_categories",
                        principalColumns: new[] { "user_id", "id" }
                    );
                    table.ForeignKey(
                        name: "FK_ledger_recurring_ledgers_user_id",
                        column: x => x.user_id,
                        principalSchema: "penny",
                        principalTable: "ledgers",
                        principalColumn: "user_id"
                    );
                }
            );

            migrationBuilder.CreateTable(
                name: "ledger_entries",
                schema: "penny",
                columns: table => new
                {
                    user_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    title = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    kind = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    total_cents = table.Column<long>(type: "bigint", nullable: false),
                    share_cents = table.Column<long>(type: "bigint", nullable: false),
                    category_id = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    account_id = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    trip_id = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    entry_date = table.Column<DateOnly>(type: "date", nullable: false),
                    note = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    receipt_id = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    recurring_id = table.Column<string>(
                        type: "text",
                        nullable: true,
                        collation: "C"
                    ),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ledger_entries", x => new { x.user_id, x.id });
                    table.CheckConstraint("ck_ledger_entries_id", "length(id) BETWEEN 1 AND 100");
                    table.CheckConstraint(
                        "ck_ledger_entries_kind",
                        "kind IN ('income','expense','investment')"
                    );
                    table.CheckConstraint(
                        "ck_ledger_entries_note",
                        "length(note) BETWEEN 0 AND 1000"
                    );
                    table.CheckConstraint(
                        "ck_ledger_entries_share",
                        "share_cents BETWEEN 0 AND total_cents"
                    );
                    table.CheckConstraint(
                        "ck_ledger_entries_title",
                        "length(title) BETWEEN 1 AND 100"
                    );
                    table.CheckConstraint(
                        "ck_ledger_entries_total",
                        "total_cents BETWEEN 1 AND 99999999999"
                    );
                    table.ForeignKey(
                        name: "FK_ledger_entries_ledger_accounts_user_id_account_id",
                        columns: x => new { x.user_id, x.account_id },
                        principalSchema: "penny",
                        principalTable: "ledger_accounts",
                        principalColumns: new[] { "user_id", "id" }
                    );
                    table.ForeignKey(
                        name: "FK_ledger_entries_ledger_categories_user_id_category_id",
                        columns: x => new { x.user_id, x.category_id },
                        principalSchema: "penny",
                        principalTable: "ledger_categories",
                        principalColumns: new[] { "user_id", "id" }
                    );
                    table.ForeignKey(
                        name: "FK_ledger_entries_ledger_trips_user_id_trip_id",
                        columns: x => new { x.user_id, x.trip_id },
                        principalSchema: "penny",
                        principalTable: "ledger_trips",
                        principalColumns: new[] { "user_id", "id" }
                    );
                    table.ForeignKey(
                        name: "FK_ledger_entries_ledgers_user_id",
                        column: x => x.user_id,
                        principalSchema: "penny",
                        principalTable: "ledgers",
                        principalColumn: "user_id"
                    );
                    table.ForeignKey(
                        name: "FK_ledger_entries_receipts_user_id_receipt_id",
                        columns: x => new { x.user_id, x.receipt_id },
                        principalSchema: "penny",
                        principalTable: "receipts",
                        principalColumns: new[] { "user_id", "id" }
                    );
                }
            );

            migrationBuilder.CreateTable(
                name: "household_reimbursements",
                schema: "penny",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    household_id = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    month = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    from_user_id = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    to_user_id = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    amount_cents = table.Column<long>(type: "bigint", nullable: false),
                    expense_id = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    created_by = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    created_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: false
                    ),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_household_reimbursements", x => x.id);
                    table.CheckConstraint(
                        "ck_household_reimbursements_amount",
                        "amount_cents BETWEEN 0 AND 99999999999"
                    );
                    table.CheckConstraint(
                        "ck_household_reimbursements_month",
                        "month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'"
                    );
                    table.ForeignKey(
                        name: "FK_household_reimbursements_household_expenses_expense_id",
                        column: x => x.expense_id,
                        principalSchema: "penny",
                        principalTable: "household_expenses",
                        principalColumn: "id"
                    );
                    table.ForeignKey(
                        name: "FK_household_reimbursements_households_household_id",
                        column: x => x.household_id,
                        principalSchema: "penny",
                        principalTable: "households",
                        principalColumn: "id"
                    );
                    table.ForeignKey(
                        name: "FK_household_reimbursements_users_created_by",
                        column: x => x.created_by,
                        principalSchema: "penny",
                        principalTable: "users",
                        principalColumn: "id"
                    );
                    table.ForeignKey(
                        name: "FK_household_reimbursements_users_from_user_id",
                        column: x => x.from_user_id,
                        principalSchema: "penny",
                        principalTable: "users",
                        principalColumn: "id"
                    );
                    table.ForeignKey(
                        name: "FK_household_reimbursements_users_to_user_id",
                        column: x => x.to_user_id,
                        principalSchema: "penny",
                        principalTable: "users",
                        principalColumn: "id"
                    );
                }
            );

            migrationBuilder.CreateTable(
                name: "household_splits",
                schema: "penny",
                columns: table => new
                {
                    expense_id = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    user_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    amount_cents = table.Column<long>(type: "bigint", nullable: false),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_household_splits", x => new { x.expense_id, x.user_id });
                    table.CheckConstraint(
                        "ck_household_splits_amount",
                        "amount_cents BETWEEN 0 AND 99999999999"
                    );
                    table.ForeignKey(
                        name: "FK_household_splits_household_expenses_expense_id",
                        column: x => x.expense_id,
                        principalSchema: "penny",
                        principalTable: "household_expenses",
                        principalColumn: "id"
                    );
                    table.ForeignKey(
                        name: "FK_household_splits_users_user_id",
                        column: x => x.user_id,
                        principalSchema: "penny",
                        principalTable: "users",
                        principalColumn: "id"
                    );
                }
            );

            migrationBuilder.CreateTable(
                name: "household_recurring_allocations",
                schema: "penny",
                columns: table => new
                {
                    recurring_id = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    user_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    amount_cents = table.Column<long>(type: "bigint", nullable: true),
                    percent_basis_points = table.Column<int>(type: "integer", nullable: true),
                },
                constraints: table =>
                {
                    table.PrimaryKey(
                        "PK_household_recurring_allocations",
                        x => new { x.recurring_id, x.user_id }
                    );
                    table.CheckConstraint(
                        "ck_household_recurring_allocations_amount",
                        "amount_cents IS NULL OR amount_cents BETWEEN 0 AND 99999999999"
                    );
                    table.CheckConstraint(
                        "ck_household_recurring_allocations_one_value",
                        "(amount_cents IS NULL) <> (percent_basis_points IS NULL)"
                    );
                    table.CheckConstraint(
                        "ck_household_recurring_allocations_percent",
                        "percent_basis_points IS NULL OR percent_basis_points BETWEEN 0 AND 10000"
                    );
                    table.ForeignKey(
                        name: "FK_household_recurring_allocations_household_recurring_recurri~",
                        column: x => x.recurring_id,
                        principalSchema: "penny",
                        principalTable: "household_recurring",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade
                    );
                    table.ForeignKey(
                        name: "FK_household_recurring_allocations_users_user_id",
                        column: x => x.user_id,
                        principalSchema: "penny",
                        principalTable: "users",
                        principalColumn: "id"
                    );
                }
            );

            migrationBuilder.CreateTable(
                name: "receipt_text_chunks",
                schema: "penny",
                columns: table => new
                {
                    id = table
                        .Column<long>(type: "bigint", nullable: false)
                        .Annotation(
                            "Npgsql:ValueGenerationStrategy",
                            NpgsqlValueGenerationStrategy.IdentityAlwaysColumn
                        ),
                    receipt_id = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    ordinal = table.Column<int>(type: "integer", nullable: false),
                    passage = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    embedding = table.Column<Vector>(type: "vector(384)", nullable: true),
                    embedding_model = table.Column<string>(
                        type: "text",
                        nullable: true,
                        collation: "C"
                    ),
                    embedding_due_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: true
                    ),
                    embedding_attempts = table.Column<int>(type: "integer", nullable: false),
                    lease_token = table.Column<string>(
                        type: "text",
                        nullable: true,
                        collation: "C"
                    ),
                    lease_expires_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: true
                    ),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_receipt_text_chunks", x => x.id);
                    table.CheckConstraint(
                        "ck_receipt_text_chunks_attempts",
                        "embedding_attempts >= 0"
                    );
                    table.CheckConstraint(
                        "ck_receipt_text_chunks_embedding",
                        "(embedding IS NULL) = (embedding_model IS NULL)"
                    );
                    table.CheckConstraint(
                        "ck_receipt_text_chunks_lease",
                        "(lease_token IS NULL) = (lease_expires_at IS NULL)"
                    );
                    table.CheckConstraint("ck_receipt_text_chunks_ordinal", "ordinal >= 0");
                    table.ForeignKey(
                        name: "FK_receipt_text_chunks_receipt_texts_receipt_id",
                        column: x => x.receipt_id,
                        principalSchema: "penny",
                        principalTable: "receipt_texts",
                        principalColumn: "receipt_id",
                        onDelete: ReferentialAction.Cascade
                    );
                }
            );

            migrationBuilder.CreateTable(
                name: "search_documents",
                schema: "penny",
                columns: table => new
                {
                    id = table
                        .Column<long>(type: "bigint", nullable: false)
                        .Annotation(
                            "Npgsql:ValueGenerationStrategy",
                            NpgsqlValueGenerationStrategy.IdentityAlwaysColumn
                        ),
                    source = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    result_key = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    user_id = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    entry_id = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    expense_id = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    household_id = table.Column<string>(
                        type: "text",
                        nullable: true,
                        collation: "C"
                    ),
                    payer_id = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    kind = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    item_date = table.Column<DateOnly>(type: "date", nullable: false),
                    amount_cents = table.Column<long>(type: "bigint", nullable: true),
                    title_text = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    document_text = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    owner_text = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    embedding_source = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    receipt_id = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    embedding = table.Column<Vector>(type: "vector(384)", nullable: true),
                    embedding_model = table.Column<string>(
                        type: "text",
                        nullable: true,
                        collation: "C"
                    ),
                    embedding_due_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: true
                    ),
                    embedding_attempts = table.Column<int>(type: "integer", nullable: false),
                    lease_token = table.Column<string>(
                        type: "text",
                        nullable: true,
                        collation: "C"
                    ),
                    lease_expires_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: true
                    ),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_search_documents", x => x.id);
                    table.CheckConstraint(
                        "ck_search_documents_attempts",
                        "embedding_attempts >= 0"
                    );
                    table.CheckConstraint(
                        "ck_search_documents_embedding",
                        "(embedding IS NULL) = (embedding_model IS NULL)"
                    );
                    table.CheckConstraint(
                        "ck_search_documents_kind",
                        "kind IN ('income','expense','investment')"
                    );
                    table.CheckConstraint(
                        "ck_search_documents_lease",
                        "(lease_token IS NULL) = (lease_expires_at IS NULL)"
                    );
                    table.CheckConstraint(
                        "ck_search_documents_shape",
                        "(source = 'personal' AND user_id IS NOT NULL AND entry_id IS NOT NULL AND expense_id IS NULL AND household_id IS NULL AND payer_id IS NULL AND amount_cents IS NOT NULL AND result_key = 'personal:' || entry_id) OR (source = 'shared' AND user_id IS NULL AND entry_id IS NULL AND expense_id IS NOT NULL AND household_id IS NOT NULL AND payer_id IS NOT NULL AND amount_cents IS NULL AND kind = 'expense' AND result_key = 'shared:' || expense_id)"
                    );
                    table.ForeignKey(
                        name: "FK_search_documents_household_expenses_expense_id",
                        column: x => x.expense_id,
                        principalSchema: "penny",
                        principalTable: "household_expenses",
                        principalColumn: "id"
                    );
                    table.ForeignKey(
                        name: "FK_search_documents_ledger_entries_user_id_entry_id",
                        columns: x => new { x.user_id, x.entry_id },
                        principalSchema: "penny",
                        principalTable: "ledger_entries",
                        principalColumns: new[] { "user_id", "id" }
                    );
                }
            );

            migrationBuilder.CreateIndex(
                name: "IX_household_audit_actor_id",
                schema: "penny",
                table: "household_audit",
                column: "actor_id"
            );

            migrationBuilder.CreateIndex(
                name: "ix_household_audit_expense_history",
                schema: "penny",
                table: "household_audit",
                columns: new[] { "household_id", "expense_id", "created_at", "sort_order" },
                descending: new[] { false, false, true, true }
            );

            migrationBuilder.CreateIndex(
                name: "ix_household_audit_history",
                schema: "penny",
                table: "household_audit",
                columns: new[] { "household_id", "created_at", "sort_order" },
                descending: new[] { false, true, true }
            );

            migrationBuilder.CreateIndex(
                name: "IX_household_audit_id",
                schema: "penny",
                table: "household_audit",
                column: "id",
                unique: true
            );

            migrationBuilder.CreateIndex(
                name: "IX_household_expenses_created_by",
                schema: "penny",
                table: "household_expenses",
                column: "created_by"
            );

            migrationBuilder.CreateIndex(
                name: "ix_household_expenses_live",
                schema: "penny",
                table: "household_expenses",
                columns: new[] { "household_id", "expense_date" },
                filter: "deleted_at IS NULL"
            );

            migrationBuilder.CreateIndex(
                name: "IX_household_expenses_payer_id",
                schema: "penny",
                table: "household_expenses",
                column: "payer_id"
            );

            migrationBuilder.CreateIndex(
                name: "IX_household_expenses_receipt_id",
                schema: "penny",
                table: "household_expenses",
                column: "receipt_id"
            );

            migrationBuilder.CreateIndex(
                name: "ix_household_expenses_recurring_occurrence",
                schema: "penny",
                table: "household_expenses",
                columns: new[] { "recurring_id", "expense_date" },
                unique: true,
                filter: "recurring_id IS NOT NULL"
            );

            migrationBuilder.CreateIndex(
                name: "IX_household_expenses_updated_by",
                schema: "penny",
                table: "household_expenses",
                column: "updated_by"
            );

            migrationBuilder.CreateIndex(
                name: "IX_household_invites_expires_at",
                schema: "penny",
                table: "household_invites",
                column: "expires_at"
            );

            migrationBuilder.CreateIndex(
                name: "IX_household_invites_household_id",
                schema: "penny",
                table: "household_invites",
                column: "household_id"
            );

            migrationBuilder.CreateIndex(
                name: "IX_household_member_periods_household_id_user_id_joined_at",
                schema: "penny",
                table: "household_member_periods",
                columns: new[] { "household_id", "user_id", "joined_at" }
            );

            migrationBuilder.CreateIndex(
                name: "ix_household_member_periods_open",
                schema: "penny",
                table: "household_member_periods",
                columns: new[] { "household_id", "user_id" },
                unique: true,
                filter: "left_at IS NULL"
            );

            migrationBuilder.CreateIndex(
                name: "IX_household_member_periods_user_id",
                schema: "penny",
                table: "household_member_periods",
                column: "user_id"
            );

            migrationBuilder.CreateIndex(
                name: "IX_household_recurring_created_by",
                schema: "penny",
                table: "household_recurring",
                column: "created_by"
            );

            migrationBuilder.CreateIndex(
                name: "ix_household_recurring_due",
                schema: "penny",
                table: "household_recurring",
                column: "next_date",
                filter: "active"
            );

            migrationBuilder.CreateIndex(
                name: "IX_household_recurring_household_id",
                schema: "penny",
                table: "household_recurring",
                column: "household_id"
            );

            migrationBuilder.CreateIndex(
                name: "IX_household_recurring_payer_id",
                schema: "penny",
                table: "household_recurring",
                column: "payer_id"
            );

            migrationBuilder.CreateIndex(
                name: "IX_household_recurring_receipt_id",
                schema: "penny",
                table: "household_recurring",
                column: "receipt_id"
            );

            migrationBuilder.CreateIndex(
                name: "IX_household_recurring_allocations_user_id",
                schema: "penny",
                table: "household_recurring_allocations",
                column: "user_id"
            );

            migrationBuilder.CreateIndex(
                name: "IX_household_reimbursements_created_by",
                schema: "penny",
                table: "household_reimbursements",
                column: "created_by"
            );

            migrationBuilder.CreateIndex(
                name: "ix_household_reimbursements_expense_payment",
                schema: "penny",
                table: "household_reimbursements",
                columns: new[] { "expense_id", "from_user_id" },
                unique: true,
                filter: "expense_id IS NOT NULL"
            );

            migrationBuilder.CreateIndex(
                name: "IX_household_reimbursements_from_user_id",
                schema: "penny",
                table: "household_reimbursements",
                column: "from_user_id"
            );

            migrationBuilder.CreateIndex(
                name: "IX_household_reimbursements_household_id_month",
                schema: "penny",
                table: "household_reimbursements",
                columns: new[] { "household_id", "month" }
            );

            migrationBuilder.CreateIndex(
                name: "IX_household_reimbursements_to_user_id",
                schema: "penny",
                table: "household_reimbursements",
                column: "to_user_id"
            );

            migrationBuilder.CreateIndex(
                name: "IX_household_splits_user_id",
                schema: "penny",
                table: "household_splits",
                column: "user_id"
            );

            migrationBuilder.CreateIndex(
                name: "IX_households_creator_id",
                schema: "penny",
                table: "households",
                column: "creator_id"
            );

            migrationBuilder.CreateIndex(
                name: "IX_ledger_entries_user_id_account_id",
                schema: "penny",
                table: "ledger_entries",
                columns: new[] { "user_id", "account_id" }
            );

            migrationBuilder.CreateIndex(
                name: "IX_ledger_entries_user_id_category_id",
                schema: "penny",
                table: "ledger_entries",
                columns: new[] { "user_id", "category_id" }
            );

            migrationBuilder.CreateIndex(
                name: "IX_ledger_entries_user_id_entry_date",
                schema: "penny",
                table: "ledger_entries",
                columns: new[] { "user_id", "entry_date" }
            );

            migrationBuilder.CreateIndex(
                name: "IX_ledger_entries_user_id_receipt_id",
                schema: "penny",
                table: "ledger_entries",
                columns: new[] { "user_id", "receipt_id" }
            );

            migrationBuilder.CreateIndex(
                name: "IX_ledger_entries_user_id_trip_id",
                schema: "penny",
                table: "ledger_entries",
                columns: new[] { "user_id", "trip_id" }
            );

            migrationBuilder.CreateIndex(
                name: "IX_ledger_recurring_user_id_account_id",
                schema: "penny",
                table: "ledger_recurring",
                columns: new[] { "user_id", "account_id" }
            );

            migrationBuilder.CreateIndex(
                name: "IX_ledger_recurring_user_id_category_id",
                schema: "penny",
                table: "ledger_recurring",
                columns: new[] { "user_id", "category_id" }
            );

            migrationBuilder.CreateIndex(
                name: "IX_ledger_trips_shared_household_id",
                schema: "penny",
                table: "ledger_trips",
                column: "shared_household_id"
            );

            migrationBuilder.CreateIndex(
                name: "IX_oidc_attempts_expires_at",
                schema: "penny",
                table: "oidc_attempts",
                column: "expires_at"
            );

            migrationBuilder.CreateIndex(
                name: "IX_oidc_identities_user_id",
                schema: "penny",
                table: "oidc_identities",
                column: "user_id"
            );

            migrationBuilder.CreateIndex(
                name: "IX_password_resets_expires_at",
                schema: "penny",
                table: "password_resets",
                column: "expires_at"
            );

            migrationBuilder.CreateIndex(
                name: "IX_password_resets_user_id",
                schema: "penny",
                table: "password_resets",
                column: "user_id",
                unique: true
            );

            migrationBuilder.CreateIndex(
                name: "ix_push_deliveries_due",
                schema: "penny",
                table: "push_deliveries",
                column: "next_attempt_at",
                filter: "sent_at IS NULL"
            );

            migrationBuilder.CreateIndex(
                name: "ix_push_deliveries_pending_token",
                schema: "penny",
                table: "push_deliveries",
                column: "token",
                filter: "sent_at IS NULL"
            );

            migrationBuilder.CreateIndex(
                name: "IX_push_devices_session_hash",
                schema: "penny",
                table: "push_devices",
                column: "session_hash"
            );

            migrationBuilder.CreateIndex(
                name: "IX_push_devices_user_id",
                schema: "penny",
                table: "push_devices",
                column: "user_id"
            );

            migrationBuilder.CreateIndex(
                name: "ix_push_outbox_due",
                schema: "penny",
                table: "push_outbox",
                column: "next_attempt_at",
                filter: "sent_at IS NULL"
            );

            migrationBuilder.CreateIndex(
                name: "IX_push_outbox_household_id",
                schema: "penny",
                table: "push_outbox",
                column: "household_id"
            );

            migrationBuilder.CreateIndex(
                name: "IX_push_outbox_user_id",
                schema: "penny",
                table: "push_outbox",
                column: "user_id"
            );

            migrationBuilder
                .CreateIndex(
                    name: "ix_receipt_text_chunks_embedding",
                    schema: "penny",
                    table: "receipt_text_chunks",
                    column: "embedding"
                )
                .Annotation("Npgsql:IndexMethod", "hnsw")
                .Annotation("Npgsql:IndexOperators", new[] { "vector_cosine_ops" });

            migrationBuilder.CreateIndex(
                name: "ix_receipt_text_chunks_embedding_due",
                schema: "penny",
                table: "receipt_text_chunks",
                column: "embedding_due_at",
                filter: "embedding_due_at IS NOT NULL"
            );

            migrationBuilder.CreateIndex(
                name: "ux_receipt_text_chunks_receipt",
                schema: "penny",
                table: "receipt_text_chunks",
                columns: new[] { "receipt_id", "ordinal" },
                unique: true
            );

            migrationBuilder.CreateIndex(
                name: "ix_receipt_texts_due",
                schema: "penny",
                table: "receipt_texts",
                column: "due_at",
                filter: "due_at IS NOT NULL"
            );

            migrationBuilder
                .CreateIndex(
                    name: "ix_receipt_texts_search_trgm",
                    schema: "penny",
                    table: "receipt_texts",
                    column: "search_text"
                )
                .Annotation("Npgsql:IndexMethod", "gin")
                .Annotation("Npgsql:IndexOperators", new[] { "gin_trgm_ops" });

            migrationBuilder.CreateIndex(
                name: "IX_receipts_storage_path",
                schema: "penny",
                table: "receipts",
                column: "storage_path",
                unique: true
            );

            migrationBuilder
                .CreateIndex(
                    name: "ix_search_documents_document_trgm",
                    schema: "penny",
                    table: "search_documents",
                    column: "document_text"
                )
                .Annotation("Npgsql:IndexMethod", "gin")
                .Annotation("Npgsql:IndexOperators", new[] { "gin_trgm_ops" });

            migrationBuilder
                .CreateIndex(
                    name: "ix_search_documents_embedding",
                    schema: "penny",
                    table: "search_documents",
                    column: "embedding"
                )
                .Annotation("Npgsql:IndexMethod", "hnsw")
                .Annotation("Npgsql:IndexOperators", new[] { "vector_cosine_ops" });

            migrationBuilder.CreateIndex(
                name: "ix_search_documents_embedding_due",
                schema: "penny",
                table: "search_documents",
                column: "embedding_due_at",
                filter: "embedding_due_at IS NOT NULL"
            );

            migrationBuilder.CreateIndex(
                name: "ix_search_documents_household",
                schema: "penny",
                table: "search_documents",
                column: "household_id"
            );

            migrationBuilder
                .CreateIndex(
                    name: "ix_search_documents_owner_trgm",
                    schema: "penny",
                    table: "search_documents",
                    column: "owner_text"
                )
                .Annotation("Npgsql:IndexMethod", "gin")
                .Annotation("Npgsql:IndexOperators", new[] { "gin_trgm_ops" });

            migrationBuilder.CreateIndex(
                name: "ix_search_documents_receipt",
                schema: "penny",
                table: "search_documents",
                column: "receipt_id",
                filter: "receipt_id IS NOT NULL"
            );

            migrationBuilder.CreateIndex(
                name: "ix_search_documents_user_date",
                schema: "penny",
                table: "search_documents",
                columns: new[] { "user_id", "item_date" }
            );

            migrationBuilder.CreateIndex(
                name: "ux_search_documents_entry",
                schema: "penny",
                table: "search_documents",
                columns: new[] { "user_id", "entry_id" },
                unique: true
            );

            migrationBuilder.CreateIndex(
                name: "ux_search_documents_expense",
                schema: "penny",
                table: "search_documents",
                column: "expense_id",
                unique: true
            );

            migrationBuilder.CreateIndex(
                name: "IX_sessions_expires_at",
                schema: "penny",
                table: "sessions",
                column: "expires_at"
            );

            migrationBuilder.CreateIndex(
                name: "IX_sessions_user_id",
                schema: "penny",
                table: "sessions",
                column: "user_id"
            );

            migrationBuilder.CreateIndex(
                name: "IX_users_email",
                schema: "penny",
                table: "users",
                column: "email",
                unique: true
            );
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "household_audit", schema: "penny");

            migrationBuilder.DropTable(name: "household_invites", schema: "penny");

            migrationBuilder.DropTable(name: "household_member_periods", schema: "penny");

            migrationBuilder.DropTable(name: "household_recurring_allocations", schema: "penny");

            migrationBuilder.DropTable(name: "household_reimbursements", schema: "penny");

            migrationBuilder.DropTable(name: "household_splits", schema: "penny");

            migrationBuilder.DropTable(name: "ledger_recurring", schema: "penny");

            migrationBuilder.DropTable(name: "oidc_attempts", schema: "penny");

            migrationBuilder.DropTable(name: "oidc_identities", schema: "penny");

            migrationBuilder.DropTable(name: "password_resets", schema: "penny");

            migrationBuilder.DropTable(name: "push_deliveries", schema: "penny");

            migrationBuilder.DropTable(name: "push_devices", schema: "penny");

            migrationBuilder.DropTable(name: "receipt_text_chunks", schema: "penny");

            migrationBuilder.DropTable(name: "search_documents", schema: "penny");

            migrationBuilder.DropTable(name: "household_recurring", schema: "penny");

            migrationBuilder.DropTable(name: "push_outbox", schema: "penny");

            migrationBuilder.DropTable(name: "sessions", schema: "penny");

            migrationBuilder.DropTable(name: "receipt_texts", schema: "penny");

            migrationBuilder.DropTable(name: "household_expenses", schema: "penny");

            migrationBuilder.DropTable(name: "ledger_entries", schema: "penny");

            migrationBuilder.DropTable(name: "ledger_accounts", schema: "penny");

            migrationBuilder.DropTable(name: "ledger_categories", schema: "penny");

            migrationBuilder.DropTable(name: "ledger_trips", schema: "penny");

            migrationBuilder.DropTable(name: "receipts", schema: "penny");

            migrationBuilder.DropTable(name: "households", schema: "penny");

            migrationBuilder.DropTable(name: "ledgers", schema: "penny");

            migrationBuilder.DropTable(name: "users", schema: "penny");
        }
    }
}
