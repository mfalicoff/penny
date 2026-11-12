using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;
using Pgvector;

#nullable disable

namespace Penny.Backend.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddReceiptTexts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "receipt_id",
                schema: "penny",
                table: "search_documents",
                type: "text",
                nullable: true,
                collation: "C"
            );

            // Raw SQL inventory (MAZ-125): existing search documents learn the receipt of
            // their entry or expense, so `search-verify` stays clean without a rebuild.
            // Receipt text itself is backfilled by the `receipts-ocr` command.
            migrationBuilder.Sql(
                "UPDATE penny.search_documents AS d SET receipt_id = e.receipt_id"
                    + " FROM penny.ledger_entries AS e WHERE d.source = 'personal'"
                    + " AND e.user_id = d.user_id AND e.id = d.entry_id AND e.receipt_id IS NOT NULL;"
            );
            migrationBuilder.Sql(
                "UPDATE penny.search_documents AS d SET receipt_id = x.receipt_id"
                    + " FROM penny.household_expenses AS x WHERE d.source = 'shared'"
                    + " AND x.id = d.expense_id AND x.receipt_id IS NOT NULL;"
            );

            migrationBuilder.CreateTable(
                name: "receipt_texts",
                schema: "penny",
                columns: table => new
                {
                    receipt_id = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    status = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    method = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    engine = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    content = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    search_text = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    pages = table.Column<int>(type: "integer", nullable: true),
                    failure = table.Column<string>(type: "text", nullable: true, collation: "C"),
                    attempts = table.Column<int>(type: "integer", nullable: false),
                    due_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: true
                    ),
                    lease_token = table.Column<string>(
                        type: "text",
                        nullable: true,
                        collation: "C"
                    ),
                    lease_expires_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: true
                    ),
                    created_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: false,
                        defaultValueSql: "now()"
                    ),
                    extracted_at = table.Column<DateTimeOffset>(
                        type: "timestamp with time zone",
                        nullable: true
                    ),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_receipt_texts", x => x.receipt_id);
                    table.CheckConstraint("ck_receipt_texts_attempts", "attempts >= 0");
                    table.CheckConstraint(
                        "ck_receipt_texts_done",
                        "status <> 'done' OR method IS NOT NULL"
                    );
                    table.CheckConstraint(
                        "ck_receipt_texts_due",
                        "(status = 'pending') = (due_at IS NOT NULL)"
                    );
                    table.CheckConstraint(
                        "ck_receipt_texts_finished",
                        "status = 'pending' OR (engine IS NOT NULL AND extracted_at IS NOT NULL)"
                    );
                    table.CheckConstraint(
                        "ck_receipt_texts_lease",
                        "(lease_token IS NULL) = (lease_expires_at IS NULL)"
                    );
                    table.CheckConstraint(
                        "ck_receipt_texts_method",
                        "method IS NULL OR method IN ('text','ocr','mixed')"
                    );
                    table.CheckConstraint("ck_receipt_texts_pages", "pages IS NULL OR pages >= 0");
                    table.CheckConstraint(
                        "ck_receipt_texts_status",
                        "status IN ('pending','done','failed','unsupported')"
                    );
                    table.ForeignKey(
                        name: "FK_receipt_texts_receipts_receipt_id",
                        column: x => x.receipt_id,
                        principalSchema: "penny",
                        principalTable: "receipts",
                        principalColumn: "id"
                    );
                }
            );

            migrationBuilder.CreateTable(
                name: "receipt_text_chunks",
                schema: "penny",
                columns: table => new
                {
                    id = table
                        .Column<long>(type: "bigint", nullable: false)
                        .Annotation(
                            "Npgsql:ValueGenerationStrategy",
                            NpgsqlValueGenerationStrategy.IdentityAlwaysColumn
                        ),
                    receipt_id = table.Column<string>(
                        type: "text",
                        nullable: false,
                        collation: "C"
                    ),
                    ordinal = table.Column<int>(type: "integer", nullable: false),
                    passage = table.Column<string>(type: "text", nullable: false, collation: "C"),
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
                    table.PrimaryKey("PK_receipt_text_chunks", x => x.id);
                    table.CheckConstraint(
                        "ck_receipt_text_chunks_attempts",
                        "embedding_attempts >= 0"
                    );
                    table.CheckConstraint(
                        "ck_receipt_text_chunks_embedding",
                        "(embedding IS NULL) = (embedding_model IS NULL)"
                    );
                    table.CheckConstraint(
                        "ck_receipt_text_chunks_lease",
                        "(lease_token IS NULL) = (lease_expires_at IS NULL)"
                    );
                    table.CheckConstraint("ck_receipt_text_chunks_ordinal", "ordinal >= 0");
                    table.ForeignKey(
                        name: "FK_receipt_text_chunks_receipt_texts_receipt_id",
                        column: x => x.receipt_id,
                        principalSchema: "penny",
                        principalTable: "receipt_texts",
                        principalColumn: "receipt_id",
                        onDelete: ReferentialAction.Cascade
                    );
                }
            );

            migrationBuilder.CreateIndex(
                name: "ix_search_documents_receipt",
                schema: "penny",
                table: "search_documents",
                column: "receipt_id",
                filter: "receipt_id IS NOT NULL"
            );

            migrationBuilder
                .CreateIndex(
                    name: "ix_receipt_text_chunks_embedding",
                    schema: "penny",
                    table: "receipt_text_chunks",
                    column: "embedding"
                )
                .Annotation("Npgsql:IndexMethod", "hnsw")
                .Annotation("Npgsql:IndexOperators", new[] { "vector_cosine_ops" });

            migrationBuilder.CreateIndex(
                name: "ix_receipt_text_chunks_embedding_due",
                schema: "penny",
                table: "receipt_text_chunks",
                column: "embedding_due_at",
                filter: "embedding_due_at IS NOT NULL"
            );

            migrationBuilder.CreateIndex(
                name: "ux_receipt_text_chunks_receipt",
                schema: "penny",
                table: "receipt_text_chunks",
                columns: new[] { "receipt_id", "ordinal" },
                unique: true
            );

            migrationBuilder.CreateIndex(
                name: "ix_receipt_texts_due",
                schema: "penny",
                table: "receipt_texts",
                column: "due_at",
                filter: "due_at IS NOT NULL"
            );

            migrationBuilder
                .CreateIndex(
                    name: "ix_receipt_texts_search_trgm",
                    schema: "penny",
                    table: "receipt_texts",
                    column: "search_text"
                )
                .Annotation("Npgsql:IndexMethod", "gin")
                .Annotation("Npgsql:IndexOperators", new[] { "gin_trgm_ops" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "receipt_text_chunks", schema: "penny");

            migrationBuilder.DropTable(name: "receipt_texts", schema: "penny");

            migrationBuilder.DropIndex(
                name: "ix_search_documents_receipt",
                schema: "penny",
                table: "search_documents"
            );

            migrationBuilder.DropColumn(
                name: "receipt_id",
                schema: "penny",
                table: "search_documents"
            );
        }
    }
}
