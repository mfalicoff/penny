using Microsoft.EntityFrameworkCore;
using Penny.Backend.Application.Receipts;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Search;

// Keeps receipt texts in step with the documents that link them (MAZ-125), inside the
// writer's transaction, after its documents are saved:
//
// - A receipt no document (personal entry or live shared expense) and no shared rule
//   references any more loses its extracted text and chunks (unlink, replacement,
//   deletion), so search stops matching it at the same commit.
// - A newly linked receipt without a text row gets a pending one (receipts uploaded
//   before MAZ-125, imports, or a link restored after its text was deleted).
//
// Both run under row locks on the receipts involved, so writers that link and unlink
// the same receipt (a personal ledger and a household) serialize instead of racing.
internal static class ReceiptTextIndex
{
    public static ReceiptText Pending(string receiptId) =>
        new()
        {
            ReceiptId = receiptId,
            Status = ReceiptTextStatus.Pending,
            DueAt = SearchIndexer.DueNow,
        };

    // New chunk rows for `passages`, due for embedding now.
    public static IEnumerable<ReceiptTextChunk> Chunks(
        string receiptId,
        IReadOnlyList<string> passages
    ) =>
        passages.Select(
            (passage, ordinal) =>
                new ReceiptTextChunk
                {
                    ReceiptId = receiptId,
                    Ordinal = ordinal,
                    Passage = passage,
                    EmbeddingDueAt = SearchIndexer.DueNow,
                }
        );

    public static async Task ApplyAsync(
        PennyDbContext context,
        ReceiptLinks links,
        CancellationToken cancellationToken
    )
    {
        var touched = links.Gained.Union(links.Released).Order(StringComparer.Ordinal).ToList();
        if (touched.Count == 0)
            return;
        // A no-op update takes the row lock (FOR NO KEY UPDATE, which does not block
        // foreign-key checks of concurrent inserts).
        await context
            .Receipts.Where(receipt => touched.Contains(receipt.Id))
            .ExecuteUpdateAsync(
                set => set.SetProperty(receipt => receipt.Mime, receipt => receipt.Mime),
                cancellationToken
            );
        var released = links.Released.ToList();
        if (released.Count > 0)
            // Chunks go with the text (ON DELETE CASCADE).
            await context
                .ReceiptTexts.Where(text =>
                    released.Contains(text.ReceiptId)
                    && !context.SearchDocuments.Any(document =>
                        document.ReceiptId == text.ReceiptId
                    )
                    && !context.HouseholdRecurring.Any(rule => rule.ReceiptId == text.ReceiptId)
                )
                .ExecuteDeleteAsync(cancellationToken);
        var gained = links.Gained.ToList();
        if (gained.Count == 0)
            return;
        var existing = await context
            .ReceiptTexts.Where(text => gained.Contains(text.ReceiptId))
            .Select(text => text.ReceiptId)
            .ToListAsync(cancellationToken);
        var missing = gained.Except(existing, StringComparer.Ordinal).ToList();
        if (missing.Count == 0)
            return;
        context.ReceiptTexts.AddRange(missing.Select(Pending));
        await context.SaveChangesAsync(cancellationToken);
    }
}
