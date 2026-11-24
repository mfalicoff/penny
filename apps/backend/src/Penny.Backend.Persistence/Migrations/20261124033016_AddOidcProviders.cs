using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Penny.Backend.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddOidcProviders : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "redirect_uri",
                schema: "penny",
                table: "oidc_attempts",
                type: "text",
                nullable: true,
                collation: "C",
                oldClrType: typeof(string),
                oldType: "text",
                oldCollation: "C"
            );

            migrationBuilder.AddColumn<string>(
                name: "provider_id",
                schema: "penny",
                table: "oidc_attempts",
                type: "text",
                nullable: false,
                // Attempts pending at the upgrade were started with the single-provider
                // settings, which are now the provider "sso".
                defaultValue: "sso",
                collation: "C"
            );

            migrationBuilder.CreateIndex(
                name: "IX_oidc_attempts_state",
                schema: "penny",
                table: "oidc_attempts",
                column: "state"
            );

            migrationBuilder.AddCheckConstraint(
                name: "CK_oidc_attempts_provider_id",
                schema: "penny",
                table: "oidc_attempts",
                sql: "provider_id ~ '^[a-z0-9][a-z0-9_-]{0,31}$'"
            );
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_oidc_attempts_state",
                schema: "penny",
                table: "oidc_attempts"
            );

            migrationBuilder.DropCheckConstraint(
                name: "CK_oidc_attempts_provider_id",
                schema: "penny",
                table: "oidc_attempts"
            );

            migrationBuilder.DropColumn(
                name: "provider_id",
                schema: "penny",
                table: "oidc_attempts"
            );

            migrationBuilder.AlterColumn<string>(
                name: "redirect_uri",
                schema: "penny",
                table: "oidc_attempts",
                type: "text",
                nullable: false,
                defaultValue: "",
                collation: "C",
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true,
                oldCollation: "C"
            );
        }
    }
}
