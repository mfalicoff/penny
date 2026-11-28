using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Penny.Backend.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCapturedPurchases : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "captured_purchases",
                schema: "penny",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    user_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    idempotency_key = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    merchant = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    amount = table.Column<long>(type: "bigint", nullable: false),
                    currency = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    card = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    captured_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: false
                    ),
                    created_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: false
                    ),
                    status = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    outcome = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    entry_id = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    household_id = table.Column<string>(
                        type: "text",
                        nullable: true,
                        collation: "C"
                    ),
                    resolved_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: true
                    ),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_captured_purchases", x => x.id);
                    table.CheckConstraint(
                        "ck_captured_purchases_amount",
                        "amount BETWEEN 1 AND 99999999999"
                    );
                    table.CheckConstraint(
                        "ck_captured_purchases_card",
                        "card IS NULL OR length(card) BETWEEN 1 AND 50"
                    );
                    table.CheckConstraint(
                        "ck_captured_purchases_currency",
                        "currency ~ '^[A-Z]{3}$'"
                    );
                    table.CheckConstraint(
                        "ck_captured_purchases_idempotency_key",
                        "length(idempotency_key) BETWEEN 1 AND 64"
                    );
                    table.CheckConstraint(
                        "ck_captured_purchases_merchant",
                        "length(merchant) BETWEEN 1 AND 100"
                    );
                    table.CheckConstraint(
                        "ck_captured_purchases_outcome",
                        "(status = 'to_review' AND outcome IS NULL AND resolved_at IS NULL AND entry_id IS NULL AND household_id IS NULL) OR (status = 'done' AND resolved_at IS NOT NULL AND ((outcome IN ('added','attached') AND entry_id IS NOT NULL) OR (outcome = 'discarded' AND entry_id IS NULL AND household_id IS NULL)))"
                    );
                    table.CheckConstraint(
                        "ck_captured_purchases_references",
                        "(entry_id IS NULL OR length(entry_id) BETWEEN 1 AND 100) AND (household_id IS NULL OR length(household_id) BETWEEN 1 AND 100)"
                    );
                    table.CheckConstraint(
                        "ck_captured_purchases_status",
                        "status IN ('to_review','done')"
                    );
                    table.ForeignKey(
                        name: "FK_captured_purchases_users_user_id",
                        column: x => x.user_id,
                        principalSchema: "penny",
                        principalTable: "users",
                        principalColumn: "id"
                    );
                }
            );

            migrationBuilder.CreateTable(
                name: "card_accounts",
                schema: "penny",
                columns: table => new
                {
                    user_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    card = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    account_id = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_card_accounts", x => new { x.user_id, x.card });
                    table.CheckConstraint(
                        "ck_card_accounts_account_id",
                        "length(account_id) BETWEEN 1 AND 100"
                    );
                    table.CheckConstraint("ck_card_accounts_card", "length(card) BETWEEN 1 AND 50");
                    table.ForeignKey(
                        name: "FK_card_accounts_users_user_id",
                        column: x => x.user_id,
                        principalSchema: "penny",
                        principalTable: "users",
                        principalColumn: "id"
                    );
                }
            );

            migrationBuilder.CreateIndex(
                name: "IX_captured_purchases_user_id_idempotency_key",
                schema: "penny",
                table: "captured_purchases",
                columns: new[] { "user_id", "idempotency_key" },
                unique: true
            );

            migrationBuilder.CreateIndex(
                name: "IX_captured_purchases_user_id_status_captured_at",
                schema: "penny",
                table: "captured_purchases",
                columns: new[] { "user_id", "status", "captured_at" }
            );
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "captured_purchases", schema: "penny");

            migrationBuilder.DropTable(name: "card_accounts", schema: "penny");
        }
    }
}
