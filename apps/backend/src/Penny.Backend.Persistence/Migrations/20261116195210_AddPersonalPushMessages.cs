using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Penny.Backend.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPersonalPushMessages : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "household_id",
                schema: "penny",
                table: "push_outbox",
                type: "text",
                nullable: true,
                collation: "C",
                oldClrType: typeof(string),
                oldType: "text",
                oldCollation: "C"
            );
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "household_id",
                schema: "penny",
                table: "push_outbox",
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
