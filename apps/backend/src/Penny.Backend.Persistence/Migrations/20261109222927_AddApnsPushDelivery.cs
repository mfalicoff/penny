using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Penny.Backend.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddApnsPushDelivery : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "environment",
                schema: "penny",
                table: "push_devices",
                type: "text",
                nullable: true,
                collation: "C"
            );

            migrationBuilder.AddColumn<string>(
                name: "provider",
                schema: "penny",
                table: "push_devices",
                type: "text",
                nullable: false,
                defaultValue: "expo",
                collation: "C"
            );

            migrationBuilder.AddColumn<string>(
                name: "last_error",
                schema: "penny",
                table: "push_deliveries",
                type: "text",
                nullable: true,
                collation: "C"
            );

            migrationBuilder.AddColumn<string>(
                name: "provider",
                schema: "penny",
                table: "push_deliveries",
                type: "text",
                nullable: false,
                defaultValue: "expo",
                collation: "C"
            );

            migrationBuilder.AddCheckConstraint(
                name: "ck_push_devices_provider",
                schema: "penny",
                table: "push_devices",
                sql: "(provider = 'expo' AND environment IS NULL) OR (provider = 'apns' AND platform = 'ios' AND environment IS NOT NULL AND environment IN ('sandbox','production'))"
            );

            migrationBuilder.CreateIndex(
                name: "ix_push_deliveries_pending_token",
                schema: "penny",
                table: "push_deliveries",
                column: "token",
                filter: "sent_at IS NULL"
            );

            migrationBuilder.AddCheckConstraint(
                name: "ck_push_deliveries_provider",
                schema: "penny",
                table: "push_deliveries",
                sql: "provider IN ('expo','apns')"
            );
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_push_devices_provider",
                schema: "penny",
                table: "push_devices"
            );

            migrationBuilder.DropIndex(
                name: "ix_push_deliveries_pending_token",
                schema: "penny",
                table: "push_deliveries"
            );

            migrationBuilder.DropCheckConstraint(
                name: "ck_push_deliveries_provider",
                schema: "penny",
                table: "push_deliveries"
            );

            migrationBuilder.DropColumn(
                name: "environment",
                schema: "penny",
                table: "push_devices"
            );

            migrationBuilder.DropColumn(name: "provider", schema: "penny", table: "push_devices");

            migrationBuilder.DropColumn(
                name: "last_error",
                schema: "penny",
                table: "push_deliveries"
            );

            migrationBuilder.DropColumn(
                name: "provider",
                schema: "penny",
                table: "push_deliveries"
            );
        }
    }
}
