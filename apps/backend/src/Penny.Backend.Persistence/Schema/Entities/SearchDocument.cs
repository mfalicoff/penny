using Pgvector;

namespace Penny.Backend.Persistence.Schema.Entities;

// One searchable result (MAZ-121): a personal ledger entry (`UserId`, `EntryId`) or a
// live shared expense (`ExpenseId`, `HouseholdId`, `PayerId`). Lexical texts are
// normalized in the application and rewritten in the same transaction as the write
// that changes them. `EmbeddingDueAt` set means the embedding is owed: these rows are
// the embedding outbox, claimed with an expiring lease and retried with backoff.
public sealed class SearchDocument
{
    public long Id { get; set; }
    public required string Source { get; set; }
    public required string ResultKey { get; set; }
    public string? UserId { get; set; }
    public string? EntryId { get; set; }
    public string? ExpenseId { get; set; }
    public string? HouseholdId { get; set; }
    public string? PayerId { get; set; }
    public required string Kind { get; set; }
    public DateOnly ItemDate { get; set; }

    // The owner's share for a personal entry; shared shares come from household_splits.
    public long? AmountCents { get; set; }
    public required string TitleText { get; set; }
    public required string DocumentText { get; set; }
    public required string OwnerText { get; set; }
    public required string EmbeddingSource { get; set; }

    // The receipt attached to the entry or expense (MAZ-125). Its text matches only for
    // viewers who may read the receipt, through `receipt_texts` and its chunks.
    public string? ReceiptId { get; set; }
    public Vector? Embedding { get; set; }
    public string? EmbeddingModel { get; set; }
    public DateTimeOffset? EmbeddingDueAt { get; set; }
    public int EmbeddingAttempts { get; set; }
    public string? LeaseToken { get; set; }
    public DateTimeOffset? LeaseExpiresAt { get; set; }
}
