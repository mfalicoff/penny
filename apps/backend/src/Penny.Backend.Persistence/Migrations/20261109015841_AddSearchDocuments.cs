using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;
using Pgvector;

#nullable disable

namespace Penny.Backend.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddSearchDocuments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder
                .AlterDatabase()
                .Annotation("Npgsql:PostgresExtension:pg_trgm", ",,")
                .Annotation("Npgsql:PostgresExtension:vector", ",,");

            migrationBuilder.CreateTable(
                name: "search_documents",
                schema: "penny",
                columns: table => new
                {
                    id = table
                        .Column<long>(type: "bigint", nullable: false)
                        .Annotation(
                            "Npgsql:ValueGenerationStrategy",
                            NpgsqlValueGenerationStrategy.IdentityAlwaysColumn
                        ),
                    source = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    result_key = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    user_id = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    entry_id = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    expense_id = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    household_id = table.Column<string>(
                        type: "text",
                        nullable: true,
                        collation: "C"
                    ),
                    payer_id = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    kind = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    item_date = table.Column<DateOnly>(type: "date", nullable: false),
                    amount_cents = table.Column<long>(type: "bigint", nullable: true),
                    title_text = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    document_text = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    owner_text = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    embedding_source = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    embedding = table.Column<Vector>(type: "vector(384)", nullable: true),
                    embedding_model = table.Column<string>(
                        type: "text",
                        nullable: true,
                        collation: "C"
                    ),
                    embedding_due_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: true
                    ),
                    embedding_attempts = table.Column<int>(type: "integer", nullable: false),
                    lease_token = table.Column<string>(
                        type: "text",
                        nullable: true,
                        collation: "C"
                    ),
                    lease_expires_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: true
                    ),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_search_documents", x => x.id);
                    table.CheckConstraint(
                        "ck_search_documents_attempts",
                        "embedding_attempts >= 0"
                    );
                    table.CheckConstraint(
                        "ck_search_documents_embedding",
                        "(embedding IS NULL) = (embedding_model IS NULL)"
                    );
                    table.CheckConstraint(
                        "ck_search_documents_kind",
                        "kind IN ('income','expense','investment')"
                    );
                    table.CheckConstraint(
                        "ck_search_documents_lease",
                        "(lease_token IS NULL) = (lease_expires_at IS NULL)"
                    );
                    table.CheckConstraint(
                        "ck_search_documents_shape",
                        "(source = 'personal' AND user_id IS NOT NULL AND entry_id IS NOT NULL AND expense_id IS NULL AND household_id IS NULL AND payer_id IS NULL AND amount_cents IS NOT NULL AND result_key = 'personal:' || entry_id) OR (source = 'shared' AND user_id IS NULL AND entry_id IS NULL AND expense_id IS NOT NULL AND household_id IS NOT NULL AND payer_id IS NOT NULL AND amount_cents IS NULL AND kind = 'expense' AND result_key = 'shared:' || expense_id)"
                    );
                    table.ForeignKey(
                        name: "FK_search_documents_household_expenses_expense_id",
                        column: x => x.expense_id,
                        principalSchema: "penny",
                        principalTable: "household_expenses",
                        principalColumn: "id"
                    );
                    table.ForeignKey(
                        name: "FK_search_documents_ledger_entries_user_id_entry_id",
                        columns: x => new { x.user_id, x.entry_id },
                        principalSchema: "penny",
                        principalTable: "ledger_entries",
                        principalColumns: new[] { "user_id", "id" }
                    );
                }
            );

            migrationBuilder
                .CreateIndex(
                    name: "ix_search_documents_document_trgm",
                    schema: "penny",
                    table: "search_documents",
                    column: "document_text"
                )
                .Annotation("Npgsql:IndexMethod", "gin")
                .Annotation("Npgsql:IndexOperators", new[] { "gin_trgm_ops" });

            migrationBuilder
                .CreateIndex(
                    name: "ix_search_documents_embedding",
                    schema: "penny",
                    table: "search_documents",
                    column: "embedding"
                )
                .Annotation("Npgsql:IndexMethod", "hnsw")
                .Annotation("Npgsql:IndexOperators", new[] { "vector_cosine_ops" });

            migrationBuilder.CreateIndex(
                name: "ix_search_documents_embedding_due",
                schema: "penny",
                table: "search_documents",
                column: "embedding_due_at",
                filter: "embedding_due_at IS NOT NULL"
            );

            migrationBuilder.CreateIndex(
                name: "ix_search_documents_household",
                schema: "penny",
                table: "search_documents",
                column: "household_id"
            );

            migrationBuilder
                .CreateIndex(
                    name: "ix_search_documents_owner_trgm",
                    schema: "penny",
                    table: "search_documents",
                    column: "owner_text"
                )
                .Annotation("Npgsql:IndexMethod", "gin")
                .Annotation("Npgsql:IndexOperators", new[] { "gin_trgm_ops" });

            migrationBuilder.CreateIndex(
                name: "ix_search_documents_user_date",
                schema: "penny",
                table: "search_documents",
                columns: new[] { "user_id", "item_date" }
            );

            migrationBuilder.CreateIndex(
                name: "ux_search_documents_entry",
                schema: "penny",
                table: "search_documents",
                columns: new[] { "user_id", "entry_id" },
                unique: true
            );

            migrationBuilder.CreateIndex(
                name: "ux_search_documents_expense",
                schema: "penny",
                table: "search_documents",
                column: "expense_id",
                unique: true
            );
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "search_documents", schema: "penny");

            migrationBuilder
                .AlterDatabase()
                .OldAnnotation("Npgsql:PostgresExtension:pg_trgm", ",,")
                .OldAnnotation("Npgsql:PostgresExtension:vector", ",,");
        }
    }
}
