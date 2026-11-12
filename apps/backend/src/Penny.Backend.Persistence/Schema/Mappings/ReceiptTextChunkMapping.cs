using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class ReceiptTextChunkMapping : IEntityTypeConfiguration<ReceiptTextChunk>
{
    public void Configure(EntityTypeBuilder<ReceiptTextChunk> builder)
    {
        builder.ToTable(
            "receipt_text_chunks",
            table =>
            {
                table.HasCheckConstraint("ck_receipt_text_chunks_ordinal", "ordinal >= 0");
                table.HasCheckConstraint(
                    "ck_receipt_text_chunks_attempts",
                    "embedding_attempts >= 0"
                );
                table.HasCheckConstraint(
                    "ck_receipt_text_chunks_lease",
                    "(lease_token IS NULL) = (lease_expires_at IS NULL)"
                );
                table.HasCheckConstraint(
                    "ck_receipt_text_chunks_embedding",
                    "(embedding IS NULL) = (embedding_model IS NULL)"
                );
            }
        );
        builder.HasKey(chunk => chunk.Id);
        builder.Property(chunk => chunk.Id).UseIdentityAlwaysColumn();
        builder
            .Property(chunk => chunk.Embedding)
            .HasColumnType("vector(" + SearchSchema.Dimensions + ")");
        // Chunks are derived from the text: deleting the text (unlink, delete or replace
        // of the receipt) deletes them in the same statement.
        builder
            .HasOne<ReceiptText>()
            .WithMany()
            .HasForeignKey(chunk => chunk.ReceiptId)
            .OnDelete(DeleteBehavior.Cascade);
        builder
            .HasIndex(chunk => new { chunk.ReceiptId, chunk.Ordinal })
            .IsUnique()
            .HasDatabaseName("ux_receipt_text_chunks_receipt");
        // Meaning: cosine distance; receipt visibility filters run inside iterative scans.
        builder
            .HasIndex(chunk => chunk.Embedding)
            .HasMethod("hnsw")
            .HasOperators("vector_cosine_ops")
            .HasDatabaseName("ix_receipt_text_chunks_embedding");
        builder
            .HasIndex(chunk => chunk.EmbeddingDueAt)
            .HasFilter("embedding_due_at IS NOT NULL")
            .HasDatabaseName("ix_receipt_text_chunks_embedding_due");
    }
}
