using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Penny.Backend.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddEntryParticipants : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "participants",
                schema: "penny",
                table: "ledger_recurring",
                type: "integer",
                nullable: true
            );

            migrationBuilder.AddColumn<int>(
                name: "participants",
                schema: "penny",
                table: "ledger_entries",
                type: "integer",
                nullable: true
            );

            migrationBuilder.AddCheckConstraint(
                name: "ck_ledger_recurring_participants",
                schema: "penny",
                table: "ledger_recurring",
                sql: "participants IS NULL OR participants BETWEEN 2 AND 100"
            );

            migrationBuilder.AddCheckConstraint(
                name: "ck_ledger_recurring_participants_kind",
                schema: "penny",
                table: "ledger_recurring",
                sql: "participants IS NULL OR kind = 'expense'"
            );

            migrationBuilder.AddCheckConstraint(
                name: "ck_ledger_entries_participants",
                schema: "penny",
                table: "ledger_entries",
                sql: "participants IS NULL OR participants BETWEEN 2 AND 100"
            );

            migrationBuilder.AddCheckConstraint(
                name: "ck_ledger_entries_participants_kind",
                schema: "penny",
                table: "ledger_entries",
                sql: "participants IS NULL OR kind = 'expense'"
            );
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_ledger_recurring_participants",
                schema: "penny",
                table: "ledger_recurring"
            );

            migrationBuilder.DropCheckConstraint(
                name: "ck_ledger_recurring_participants_kind",
                schema: "penny",
                table: "ledger_recurring"
            );

            migrationBuilder.DropCheckConstraint(
                name: "ck_ledger_entries_participants",
                schema: "penny",
                table: "ledger_entries"
            );

            migrationBuilder.DropCheckConstraint(
                name: "ck_ledger_entries_participants_kind",
                schema: "penny",
                table: "ledger_entries"
            );

            migrationBuilder.DropColumn(
                name: "participants",
                schema: "penny",
                table: "ledger_recurring"
            );

            migrationBuilder.DropColumn(
                name: "participants",
                schema: "penny",
                table: "ledger_entries"
            );
        }
    }
}
