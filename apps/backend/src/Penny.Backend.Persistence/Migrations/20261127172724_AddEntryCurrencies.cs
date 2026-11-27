using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Penny.Backend.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddEntryCurrencies : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "original_amount",
                schema: "penny",
                table: "ledger_entries",
                type: "bigint",
                nullable: true
            );

            migrationBuilder.AddColumn<string>(
                name: "original_currency",
                schema: "penny",
                table: "ledger_entries",
                type: "text",
                nullable: true,
                collation: "C"
            );

            migrationBuilder.AddColumn<string>(
                name: "rate",
                schema: "penny",
                table: "ledger_entries",
                type: "text",
                nullable: true,
                collation: "C"
            );

            migrationBuilder.AddColumn<DateOnly>(
                name: "rate_date",
                schema: "penny",
                table: "ledger_entries",
                type: "date",
                nullable: true
            );

            migrationBuilder.AddColumn<string>(
                name: "rate_status",
                schema: "penny",
                table: "ledger_entries",
                type: "text",
                nullable: true,
                collation: "C"
            );

            migrationBuilder.CreateTable(
                name: "exchange_rates",
                schema: "penny",
                columns: table => new
                {
                    rate_date = table.Column<DateOnly>(type: "date", nullable: false),
                    currency = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    per_euro = table.Column<string>(type: "text", nullable: false, collation: "C"),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_exchange_rates", x => new { x.rate_date, x.currency });
                    table.CheckConstraint("ck_exchange_rates_currency", "currency ~ '^[A-Z]{3}$'");
                    table.CheckConstraint(
                        "ck_exchange_rates_per_euro",
                        "per_euro ~ '^(0|[1-9][0-9]{0,8})([.][0-9]{0,7}[1-9])?$' AND per_euro ~ '[1-9]'"
                    );
                }
            );

            migrationBuilder.AddCheckConstraint(
                name: "ck_ledger_entries_foreign",
                schema: "penny",
                table: "ledger_entries",
                sql: "(original_amount IS NULL) = (original_currency IS NULL) AND (original_currency IS NULL) = (rate IS NULL) AND (rate IS NULL) = (rate_status IS NULL)"
            );

            migrationBuilder.AddCheckConstraint(
                name: "ck_ledger_entries_original_amount",
                schema: "penny",
                table: "ledger_entries",
                sql: "original_amount IS NULL OR original_amount BETWEEN 1 AND 99999999999"
            );

            migrationBuilder.AddCheckConstraint(
                name: "ck_ledger_entries_original_currency",
                schema: "penny",
                table: "ledger_entries",
                sql: "original_currency IS NULL OR original_currency ~ '^[A-Z]{3}$'"
            );

            migrationBuilder.AddCheckConstraint(
                name: "ck_ledger_entries_rate",
                schema: "penny",
                table: "ledger_entries",
                sql: "rate IS NULL OR (rate ~ '^(0|[1-9][0-9]{0,8})([.][0-9]{0,7}[1-9])?$' AND rate ~ '[1-9]')"
            );

            migrationBuilder.AddCheckConstraint(
                name: "ck_ledger_entries_rate_date",
                schema: "penny",
                table: "ledger_entries",
                sql: "(rate_date IS NULL) = (rate_status IS NULL OR rate_status = 'edited')"
            );

            migrationBuilder.AddCheckConstraint(
                name: "ck_ledger_entries_rate_status",
                schema: "penny",
                table: "ledger_entries",
                sql: "rate_status IS NULL OR rate_status IN ('published','provisional','edited')"
            );
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "exchange_rates", schema: "penny");

            migrationBuilder.DropCheckConstraint(
                name: "ck_ledger_entries_foreign",
                schema: "penny",
                table: "ledger_entries"
            );

            migrationBuilder.DropCheckConstraint(
                name: "ck_ledger_entries_original_amount",
                schema: "penny",
                table: "ledger_entries"
            );

            migrationBuilder.DropCheckConstraint(
                name: "ck_ledger_entries_original_currency",
                schema: "penny",
                table: "ledger_entries"
            );

            migrationBuilder.DropCheckConstraint(
                name: "ck_ledger_entries_rate",
                schema: "penny",
                table: "ledger_entries"
            );

            migrationBuilder.DropCheckConstraint(
                name: "ck_ledger_entries_rate_date",
                schema: "penny",
                table: "ledger_entries"
            );

            migrationBuilder.DropCheckConstraint(
                name: "ck_ledger_entries_rate_status",
                schema: "penny",
                table: "ledger_entries"
            );

            migrationBuilder.DropColumn(
                name: "original_amount",
                schema: "penny",
                table: "ledger_entries"
            );

            migrationBuilder.DropColumn(
                name: "original_currency",
                schema: "penny",
                table: "ledger_entries"
            );

            migrationBuilder.DropColumn(name: "rate", schema: "penny", table: "ledger_entries");

            migrationBuilder.DropColumn(
                name: "rate_date",
                schema: "penny",
                table: "ledger_entries"
            );

            migrationBuilder.DropColumn(
                name: "rate_status",
                schema: "penny",
                table: "ledger_entries"
            );
        }
    }
}
