using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Penny.Backend.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddEmailVerification : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_mail_outbox_kind",
                schema: "penny",
                table: "mail_outbox"
            );

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "email_verified_at",
                schema: "penny",
                table: "users",
                type: "timestamp with time zone",
                nullable: true
            );

            // MAZ-172 backfill: every account that exists before email verification counts
            // as verified (the owner's decision). EF has no set-based update for existing rows.
            migrationBuilder.Sql("UPDATE penny.users SET email_verified_at = now();");

            migrationBuilder.CreateTable(
                name: "email_verifications",
                schema: "penny",
                columns: table => new
                {
                    token_hash = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    user_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    email = table.Column<string>(type: "text", nullable: false, collation: "C"),
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
                    table.PrimaryKey("PK_email_verifications", x => x.token_hash);
                    table.CheckConstraint(
                        "CK_email_verifications_email",
                        "length(email) BETWEEN 3 AND 254"
                    );
                    table.CheckConstraint(
                        "CK_email_verifications_expiry",
                        "expires_at > created_at"
                    );
                    table.CheckConstraint(
                        "CK_email_verifications_token_hash",
                        "token_hash ~ '^[0-9a-f]{64}$'"
                    );
                    table.ForeignKey(
                        name: "FK_email_verifications_users_user_id",
                        column: x => x.user_id,
                        principalSchema: "penny",
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade
                    );
                }
            );

            migrationBuilder.AddCheckConstraint(
                name: "ck_mail_outbox_kind",
                schema: "penny",
                table: "mail_outbox",
                sql: "(kind IN ('password-reset', 'email-verification') AND user_id IS NOT NULL AND email_invite_id IS NULL) OR (kind = 'household-invite' AND email_invite_id IS NOT NULL AND user_id IS NULL)"
            );

            migrationBuilder.CreateIndex(
                name: "IX_email_verifications_expires_at",
                schema: "penny",
                table: "email_verifications",
                column: "expires_at"
            );

            migrationBuilder.CreateIndex(
                name: "IX_email_verifications_user_id",
                schema: "penny",
                table: "email_verifications",
                column: "user_id",
                unique: true
            );
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "email_verifications", schema: "penny");

            migrationBuilder.DropCheckConstraint(
                name: "ck_mail_outbox_kind",
                schema: "penny",
                table: "mail_outbox"
            );

            migrationBuilder.DropColumn(name: "email_verified_at", schema: "penny", table: "users");

            migrationBuilder.AddCheckConstraint(
                name: "ck_mail_outbox_kind",
                schema: "penny",
                table: "mail_outbox",
                sql: "(kind = 'password-reset' AND user_id IS NOT NULL AND email_invite_id IS NULL) OR (kind = 'household-invite' AND email_invite_id IS NOT NULL AND user_id IS NULL)"
            );
        }
    }
}
