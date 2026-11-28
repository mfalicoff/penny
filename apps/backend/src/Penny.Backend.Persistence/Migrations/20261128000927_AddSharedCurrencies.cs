using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Penny.Backend.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddSharedCurrencies : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_households_currency",
                schema: "penny",
                table: "households"
            );

            migrationBuilder.AddColumn<string>(
                name: "currency",
                schema: "penny",
                table: "ledger_trips",
                type: "text",
                nullable: true,
                collation: "C"
            );

            migrationBuilder.AddColumn<long>(
                name: "original_amount",
                schema: "penny",
                table: "household_expenses",
                type: "bigint",
                nullable: true
            );

            migrationBuilder.AddColumn<string>(
                name: "original_currency",
                schema: "penny",
                table: "household_expenses",
                type: "text",
                nullable: true,
                collation: "C"
            );

            migrationBuilder.AddColumn<string>(
                name: "rate",
                schema: "penny",
                table: "household_expenses",
                type: "text",
                nullable: true,
                collation: "C"
            );

            migrationBuilder.AddColumn<DateOnly>(
                name: "rate_date",
                schema: "penny",
                table: "household_expenses",
                type: "date",
                nullable: true
            );

            migrationBuilder.AddColumn<string>(
                name: "rate_status",
                schema: "penny",
                table: "household_expenses",
                type: "text",
                nullable: true,
                collation: "C"
            );

            migrationBuilder.AddCheckConstraint(
                name: "ck_ledger_trips_currency",
                schema: "penny",
                table: "ledger_trips",
                sql: "currency IS NULL OR currency ~ '^[A-Z]{3}$'"
            );

            migrationBuilder.AddCheckConstraint(
                name: "ck_households_currency",
                schema: "penny",
                table: "households",
                sql: "currency ~ '^[A-Z]{3}$'"
            );

            migrationBuilder.AddCheckConstraint(
                name: "ck_household_expenses_foreign",
                schema: "penny",
                table: "household_expenses",
                sql: "(original_amount IS NULL) = (original_currency IS NULL) AND (original_currency IS NULL) = (rate IS NULL) AND (rate IS NULL) = (rate_status IS NULL)"
            );

            migrationBuilder.AddCheckConstraint(
                name: "ck_household_expenses_original_amount",
                schema: "penny",
                table: "household_expenses",
                sql: "original_amount IS NULL OR original_amount BETWEEN 1 AND 99999999999"
            );

            migrationBuilder.AddCheckConstraint(
                name: "ck_household_expenses_original_currency",
                schema: "penny",
                table: "household_expenses",
                sql: "original_currency IS NULL OR original_currency ~ '^[A-Z]{3}$'"
            );

            migrationBuilder.AddCheckConstraint(
                name: "ck_household_expenses_rate",
                schema: "penny",
                table: "household_expenses",
                sql: "rate IS NULL OR (rate ~ '^(0|[1-9][0-9]{0,8})([.][0-9]{0,7}[1-9])?$' AND rate ~ '[1-9]')"
            );

            migrationBuilder.AddCheckConstraint(
                name: "ck_household_expenses_rate_date",
                schema: "penny",
                table: "household_expenses",
                sql: "(rate_date IS NULL) = (rate_status IS NULL OR rate_status = 'edited')"
            );

            migrationBuilder.AddCheckConstraint(
                name: "ck_household_expenses_rate_status",
                schema: "penny",
                table: "household_expenses",
                sql: "rate_status IS NULL OR rate_status IN ('published','provisional','edited')"
            );
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_ledger_trips_currency",
                schema: "penny",
                table: "ledger_trips"
            );

            migrationBuilder.DropCheckConstraint(
                name: "ck_households_currency",
                schema: "penny",
                table: "households"
            );

            migrationBuilder.DropCheckConstraint(
                name: "ck_household_expenses_foreign",
                schema: "penny",
                table: "household_expenses"
            );

            migrationBuilder.DropCheckConstraint(
                name: "ck_household_expenses_original_amount",
                schema: "penny",
                table: "household_expenses"
            );

            migrationBuilder.DropCheckConstraint(
                name: "ck_household_expenses_original_currency",
                schema: "penny",
                table: "household_expenses"
            );

            migrationBuilder.DropCheckConstraint(
                name: "ck_household_expenses_rate",
                schema: "penny",
                table: "household_expenses"
            );

            migrationBuilder.DropCheckConstraint(
                name: "ck_household_expenses_rate_date",
                schema: "penny",
                table: "household_expenses"
            );

            migrationBuilder.DropCheckConstraint(
                name: "ck_household_expenses_rate_status",
                schema: "penny",
                table: "household_expenses"
            );

            migrationBuilder.DropColumn(name: "currency", schema: "penny", table: "ledger_trips");

            migrationBuilder.DropColumn(
                name: "original_amount",
                schema: "penny",
                table: "household_expenses"
            );

            migrationBuilder.DropColumn(
                name: "original_currency",
                schema: "penny",
                table: "household_expenses"
            );

            migrationBuilder.DropColumn(name: "rate", schema: "penny", table: "household_expenses");

            migrationBuilder.DropColumn(
                name: "rate_date",
                schema: "penny",
                table: "household_expenses"
            );

            migrationBuilder.DropColumn(
                name: "rate_status",
                schema: "penny",
                table: "household_expenses"
            );

            migrationBuilder.AddCheckConstraint(
                name: "ck_households_currency",
                schema: "penny",
                table: "households",
                sql: "currency IN ('CAD','USD','EUR','GBP')"
            );
        }
    }
}
