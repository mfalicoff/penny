using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Penny.Backend.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddUserProfiles : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "avatar_from_provider",
                schema: "penny",
                table: "users",
                type: "boolean",
                nullable: false,
                defaultValue: false
            );

            migrationBuilder.AddColumn<byte[]>(
                name: "avatar_source_hash",
                schema: "penny",
                table: "users",
                type: "bytea",
                nullable: true
            );

            migrationBuilder.AddColumn<string>(
                name: "avatar_version",
                schema: "penny",
                table: "users",
                type: "text",
                nullable: true,
                collation: "C"
            );

            migrationBuilder.AddColumn<string>(
                name: "display_name",
                schema: "penny",
                table: "users",
                type: "text",
                nullable: true,
                collation: "C"
            );

            migrationBuilder.AddColumn<bool>(
                name: "name_from_provider",
                schema: "penny",
                table: "users",
                type: "boolean",
                nullable: false,
                defaultValue: false
            );

            migrationBuilder.AddColumn<bool>(
                name: "name_prompt_dismissed",
                schema: "penny",
                table: "users",
                type: "boolean",
                nullable: false,
                defaultValue: false
            );

            migrationBuilder.CreateTable(
                name: "user_avatars",
                schema: "penny",
                columns: table => new
                {
                    user_id = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    content = table.Column<byte[]>(type: "bytea", nullable: false),
                    mime = table.Column<string>(type: "text", nullable: false, collation: "C"),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_avatars", x => x.user_id);
                    table.CheckConstraint(
                        "ck_user_avatars_content",
                        "length(content) BETWEEN 1 AND 1048576"
                    );
                    table.CheckConstraint("ck_user_avatars_mime", "mime = 'image/webp'");
                    table.ForeignKey(
                        name: "FK_user_avatars_users_user_id",
                        column: x => x.user_id,
                        principalSchema: "penny",
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade
                    );
                }
            );

            migrationBuilder.AddCheckConstraint(
                name: "ck_users_avatar_source_hash",
                schema: "penny",
                table: "users",
                sql: "avatar_source_hash IS NULL OR length(avatar_source_hash) = 32"
            );

            migrationBuilder.AddCheckConstraint(
                name: "ck_users_avatar_version",
                schema: "penny",
                table: "users",
                sql: "avatar_version IS NULL OR avatar_version ~ '^[0-9a-f]{32}$'"
            );

            migrationBuilder.AddCheckConstraint(
                name: "ck_users_display_name",
                schema: "penny",
                table: "users",
                sql: "display_name IS NULL OR length(display_name) BETWEEN 1 AND 60"
            );
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "user_avatars", schema: "penny");

            migrationBuilder.DropCheckConstraint(
                name: "ck_users_avatar_source_hash",
                schema: "penny",
                table: "users"
            );

            migrationBuilder.DropCheckConstraint(
                name: "ck_users_avatar_version",
                schema: "penny",
                table: "users"
            );

            migrationBuilder.DropCheckConstraint(
                name: "ck_users_display_name",
                schema: "penny",
                table: "users"
            );

            migrationBuilder.DropColumn(
                name: "avatar_from_provider",
                schema: "penny",
                table: "users"
            );

            migrationBuilder.DropColumn(
                name: "avatar_source_hash",
                schema: "penny",
                table: "users"
            );

            migrationBuilder.DropColumn(name: "avatar_version", schema: "penny", table: "users");

            migrationBuilder.DropColumn(name: "display_name", schema: "penny", table: "users");

            migrationBuilder.DropColumn(
                name: "name_from_provider",
                schema: "penny",
                table: "users"
            );

            migrationBuilder.DropColumn(
                name: "name_prompt_dismissed",
                schema: "penny",
                table: "users"
            );
        }
    }
}
