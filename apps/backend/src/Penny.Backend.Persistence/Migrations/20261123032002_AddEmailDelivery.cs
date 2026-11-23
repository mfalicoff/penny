using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Penny.Backend.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddEmailDelivery : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "household_email_invites",
                schema: "penny",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    household_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    invited_by = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    email = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    code_hash = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    requested_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    sent_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    failed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    joined_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    revoked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_household_email_invites", x => x.id);
                    table.CheckConstraint("ck_household_email_invites_code", "(code_hash IS NULL) = (expires_at IS NULL)");
                    table.CheckConstraint("ck_household_email_invites_code_hash", "code_hash IS NULL OR code_hash ~ '^[0-9a-f]{64}$'");
                    table.CheckConstraint("ck_household_email_invites_email", "length(email) BETWEEN 3 AND 254");
                    table.ForeignKey(
                        name: "FK_household_email_invites_households_household_id",
                        column: x => x.household_id,
                        principalSchema: "penny",
                        principalTable: "households",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_household_email_invites_users_invited_by",
                        column: x => x.invited_by,
                        principalSchema: "penny",
                        principalTable: "users",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "mail_outbox",
                schema: "penny",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    kind = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    user_id = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    email_invite_id = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    account_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    recipient_hash = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    locale = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    attempts = table.Column<int>(type: "integer", nullable: false),
                    next_attempt_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    finished_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    sent_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    last_error = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    lease_owner = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    lease_token = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    lease_expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_mail_outbox", x => x.id);
                    table.CheckConstraint("ck_mail_outbox_attempts", "attempts >= 0");
                    table.CheckConstraint("ck_mail_outbox_kind", "(kind = 'password-reset' AND user_id IS NOT NULL AND email_invite_id IS NULL) OR (kind = 'household-invite' AND email_invite_id IS NOT NULL AND user_id IS NULL)");
                    table.CheckConstraint("ck_mail_outbox_lease", "(lease_owner IS NULL) = (lease_token IS NULL) AND (lease_token IS NULL) = (lease_expires_at IS NULL)");
                    table.CheckConstraint("ck_mail_outbox_locale", "locale IN ('en','fr')");
                    table.CheckConstraint("ck_mail_outbox_recipient_hash", "recipient_hash ~ '^[0-9a-f]{64}$'");
                    table.CheckConstraint("ck_mail_outbox_sent", "sent_at IS NULL OR finished_at IS NOT NULL");
                    table.ForeignKey(
                        name: "FK_mail_outbox_household_email_invites_email_invite_id",
                        column: x => x.email_invite_id,
                        principalSchema: "penny",
                        principalTable: "household_email_invites",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_mail_outbox_users_account_id",
                        column: x => x.account_id,
                        principalSchema: "penny",
                        principalTable: "users",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_mail_outbox_users_user_id",
                        column: x => x.user_id,
                        principalSchema: "penny",
                        principalTable: "users",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_household_email_invites_code_hash",
                schema: "penny",
                table: "household_email_invites",
                column: "code_hash",
                unique: true,
                filter: "code_hash IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_household_email_invites_household_id_email",
                schema: "penny",
                table: "household_email_invites",
                columns: new[] { "household_id", "email" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_household_email_invites_invited_by",
                schema: "penny",
                table: "household_email_invites",
                column: "invited_by");

            migrationBuilder.CreateIndex(
                name: "ix_mail_outbox_account",
                schema: "penny",
                table: "mail_outbox",
                columns: new[] { "account_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_mail_outbox_created_at",
                schema: "penny",
                table: "mail_outbox",
                column: "created_at");

            migrationBuilder.CreateIndex(
                name: "ix_mail_outbox_due",
                schema: "penny",
                table: "mail_outbox",
                column: "next_attempt_at",
                filter: "finished_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_mail_outbox_email_invite_id",
                schema: "penny",
                table: "mail_outbox",
                column: "email_invite_id");

            migrationBuilder.CreateIndex(
                name: "ix_mail_outbox_recipient",
                schema: "penny",
                table: "mail_outbox",
                columns: new[] { "recipient_hash", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_mail_outbox_user_id",
                schema: "penny",
                table: "mail_outbox",
                column: "user_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "mail_outbox",
                schema: "penny");

            migrationBuilder.DropTable(
                name: "household_email_invites",
                schema: "penny");
        }
    }
}
