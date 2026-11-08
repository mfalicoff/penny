using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Penny.Backend.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPasswordResets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
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
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "password_resets", schema: "penny");
        }
    }
}
