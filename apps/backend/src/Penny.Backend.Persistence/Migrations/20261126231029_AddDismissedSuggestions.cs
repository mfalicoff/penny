using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Penny.Backend.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDismissedSuggestions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ledger_dismissed_suggestions",
                schema: "penny",
                columns: table => new
                {
                    user_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    value = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    position = table.Column<int>(type: "integer", nullable: false),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ledger_dismissed_suggestions", x => new
                    {
                        x.user_id,
                        x.value,
                    });
                    table.CheckConstraint(
                        "ck_ledger_dismissed_suggestions_position",
                        "position BETWEEN 0 AND 499"
                    );
                    table.CheckConstraint(
                        "ck_ledger_dismissed_suggestions_value",
                        "length(value) BETWEEN 1 AND 200"
                    );
                    table.ForeignKey(
                        name: "FK_ledger_dismissed_suggestions_ledgers_user_id",
                        column: x => x.user_id,
                        principalSchema: "penny",
                        principalTable: "ledgers",
                        principalColumn: "user_id"
                    );
                }
            );
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "ledger_dismissed_suggestions", schema: "penny");
        }
    }
}
