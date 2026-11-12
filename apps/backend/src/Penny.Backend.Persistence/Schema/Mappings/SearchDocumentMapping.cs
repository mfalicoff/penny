using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class SearchDocumentMapping : IEntityTypeConfiguration<SearchDocument>
{
    public void Configure(EntityTypeBuilder<SearchDocument> builder)
    {
        builder.ToTable(
            "search_documents",
            table =>
            {
                table.HasCheckConstraint(
                    "ck_search_documents_shape",
                    "(source = 'personal' AND user_id IS NOT NULL AND entry_id IS NOT NULL"
                        + " AND expense_id IS NULL AND household_id IS NULL AND payer_id IS NULL"
                        + " AND amount_cents IS NOT NULL AND result_key = 'personal:' || entry_id)"
                        + " OR (source = 'shared' AND user_id IS NULL AND entry_id IS NULL"
                        + " AND expense_id IS NOT NULL AND household_id IS NOT NULL"
                        + " AND payer_id IS NOT NULL AND amount_cents IS NULL"
                        + " AND kind = 'expense' AND result_key = 'shared:' || expense_id)"
                );
                table.HasCheckConstraint(
                    "ck_search_documents_kind",
                    Checks.In("kind", Checks.Kinds)
                );
                table.HasCheckConstraint("ck_search_documents_attempts", "embedding_attempts >= 0");
                table.HasCheckConstraint(
                    "ck_search_documents_lease",
                    "(lease_token IS NULL) = (lease_expires_at IS NULL)"
                );
                table.HasCheckConstraint(
                    "ck_search_documents_embedding",
                    "(embedding IS NULL) = (embedding_model IS NULL)"
                );
            }
        );
        builder.HasKey(document => document.Id);
        builder.Property(document => document.Id).UseIdentityAlwaysColumn();
        builder
            .Property(document => document.Embedding)
            .HasColumnType("vector(" + SearchSchema.Dimensions + ")");
        builder
            .HasOne<LedgerEntry>()
            .WithMany()
            .HasForeignKey(document => new { document.UserId, document.EntryId });
        builder.HasOne<HouseholdExpense>().WithMany().HasForeignKey(document => document.ExpenseId);
        builder
            .HasIndex(document => new { document.UserId, document.EntryId })
            .IsUnique()
            .HasDatabaseName("ux_search_documents_entry");
        builder
            .HasIndex(document => document.ExpenseId)
            .IsUnique()
            .HasDatabaseName("ux_search_documents_expense");
        builder
            .HasIndex(document => new { document.UserId, document.ItemDate })
            .HasDatabaseName("ix_search_documents_user_date");
        builder
            .HasIndex(document => document.HouseholdId)
            .HasDatabaseName("ix_search_documents_household");
        // Receipt text matches join through the receipt (MAZ-125).
        builder
            .HasIndex(document => document.ReceiptId)
            .HasFilter("receipt_id IS NOT NULL")
            .HasDatabaseName("ix_search_documents_receipt");
        // Literal substring (LIKE) and word_similarity (<%) on the stored texts.
        builder
            .HasIndex(document => document.OwnerText)
            .HasMethod("gin")
            .HasOperators("gin_trgm_ops")
            .HasDatabaseName("ix_search_documents_owner_trgm");
        builder
            .HasIndex(document => document.DocumentText)
            .HasMethod("gin")
            .HasOperators("gin_trgm_ops")
            .HasDatabaseName("ix_search_documents_document_trgm");
        // Meaning: cosine distance; authorization filters run inside iterative scans.
        builder
            .HasIndex(document => document.Embedding)
            .HasMethod("hnsw")
            .HasOperators("vector_cosine_ops")
            .HasDatabaseName("ix_search_documents_embedding");
        builder
            .HasIndex(document => document.EmbeddingDueAt)
            .HasFilter("embedding_due_at IS NOT NULL")
            .HasDatabaseName("ix_search_documents_embedding_due");
    }
}
