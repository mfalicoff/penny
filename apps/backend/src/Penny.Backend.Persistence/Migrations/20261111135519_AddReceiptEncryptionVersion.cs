using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Penny.Backend.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddReceiptEncryptionVersion : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<short>(
                name: "encryption_version",
                schema: "penny",
                table: "receipts",
                type: "smallint",
                nullable: false,
                defaultValue: (short)1
            );

            migrationBuilder.AddCheckConstraint(
                name: "ck_receipts_encryption_version",
                schema: "penny",
                table: "receipts",
                sql: "encryption_version = 1"
            );
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_receipts_encryption_version",
                schema: "penny",
                table: "receipts"
            );

            migrationBuilder.DropColumn(
                name: "encryption_version",
                schema: "penny",
                table: "receipts"
            );
        }
    }
}
