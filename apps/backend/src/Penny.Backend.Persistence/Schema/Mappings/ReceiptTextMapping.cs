using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class ReceiptTextMapping : IEntityTypeConfiguration<ReceiptText>
{
    public void Configure(EntityTypeBuilder<ReceiptText> builder)
    {
        builder.ToTable(
            "receipt_texts",
            table =>
            {
                table.HasCheckConstraint(
                    "ck_receipt_texts_status",
                    Checks.In("status", "('pending','done','failed','unsupported')")
                );
                table.HasCheckConstraint(
                    "ck_receipt_texts_method",
                    "method IS NULL OR method IN ('text','ocr','mixed')"
                );
                // Pending rows are exactly the due ones; finished rows say what made them.
                table.HasCheckConstraint(
                    "ck_receipt_texts_due",
                    "(status = 'pending') = (due_at IS NOT NULL)"
                );
                table.HasCheckConstraint(
                    "ck_receipt_texts_finished",
                    "status = 'pending' OR (engine IS NOT NULL AND extracted_at IS NOT NULL)"
                );
                table.HasCheckConstraint(
                    "ck_receipt_texts_done",
                    "status <> 'done' OR method IS NOT NULL"
                );
                table.HasCheckConstraint("ck_receipt_texts_attempts", "attempts >= 0");
                table.HasCheckConstraint("ck_receipt_texts_pages", "pages IS NULL OR pages >= 0");
                table.HasCheckConstraint(
                    "ck_receipt_texts_lease",
                    "(lease_token IS NULL) = (lease_expires_at IS NULL)"
                );
            }
        );
        builder.HasKey(text => text.ReceiptId);
        builder.Property(text => text.CreatedAt).HasDefaultValueSql("now()");
        builder.HasOne<Receipt>().WithMany().HasForeignKey(text => text.ReceiptId);
        // Literal substring (LIKE) and word_similarity (<%) on the normalized text.
        builder
            .HasIndex(text => text.SearchText)
            .HasMethod("gin")
            .HasOperators("gin_trgm_ops")
            .HasDatabaseName("ix_receipt_texts_search_trgm");
        builder
            .HasIndex(text => text.DueAt)
            .HasFilter("due_at IS NOT NULL")
            .HasDatabaseName("ix_receipt_texts_due");
    }
}
