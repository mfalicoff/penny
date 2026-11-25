using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Penny.Backend.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RedactAuditSnapshots : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // One-time redaction: audit rows imported from the old SQLite database may
            // still hold the payer's private account (top-level `accountId`) or the
            // receipt's filename (`receipt.name`). Only object snapshots are changed,
            // exactly what the checks below reject. EF has no set-based jsonb update.
            foreach (var column in new[] { "before_json", "after_json" })
                migrationBuilder.Sql(
                    $$"""
                    UPDATE penny.household_audit SET {{column}} = {{column}} - 'accountId'
                    WHERE jsonb_typeof({{column}}) = 'object' AND {{column}} ? 'accountId';
                    UPDATE penny.household_audit
                    SET {{column}} = jsonb_set({{column}}, '{receipt}', ({{column}} -> 'receipt') - 'name')
                    WHERE jsonb_typeof({{column}} -> 'receipt') = 'object' AND ({{column}} -> 'receipt') ? 'name';
                    """
                );

            migrationBuilder.AddCheckConstraint(
                name: "ck_household_audit_after_private",
                schema: "penny",
                table: "household_audit",
                sql: "NOT (jsonb_typeof(after_json) = 'object' AND after_json ? 'accountId') AND NOT (jsonb_typeof(after_json -> 'receipt') = 'object' AND (after_json -> 'receipt') ? 'name')"
            );

            migrationBuilder.AddCheckConstraint(
                name: "ck_household_audit_before_private",
                schema: "penny",
                table: "household_audit",
                sql: "NOT (jsonb_typeof(before_json) = 'object' AND before_json ? 'accountId') AND NOT (jsonb_typeof(before_json -> 'receipt') = 'object' AND (before_json -> 'receipt') ? 'name')"
            );
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_household_audit_after_private",
                schema: "penny",
                table: "household_audit"
            );

            migrationBuilder.DropCheckConstraint(
                name: "ck_household_audit_before_private",
                schema: "penny",
                table: "household_audit"
            );
        }
    }
}
