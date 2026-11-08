using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Penny.Backend.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddOidcAttempts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
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

            migrationBuilder.CreateIndex(
                name: "IX_oidc_attempts_expires_at",
                schema: "penny",
                table: "oidc_attempts",
                column: "expires_at"
            );
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "oidc_attempts", schema: "penny");
        }
    }
}
