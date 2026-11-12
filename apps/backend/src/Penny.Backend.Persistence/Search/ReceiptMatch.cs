using Penny.Backend.Persistence.Receipts;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;
using Pgvector;

namespace Penny.Backend.Persistence.Search;

// The receipt text a viewer may match (MAZ-125): texts and current-model chunks of the
// receipts they may read (ReceiptAccess, the download rule), never those of receipts
// that are only attached to an entry they can see. Composed into the search statement
// as correlated subqueries, so the rule runs in the same snapshot as everything else.
internal sealed class ReceiptMatch
{
    public ReceiptMatch(PennyDbContext context, string viewer, string model, Vector vector)
    {
        var readable = context.Receipts.Where(ReceiptAccess.Readable(context, viewer));
        Texts = context.ReceiptTexts.Where(text =>
            readable.Any(receipt => receipt.Id == text.ReceiptId)
        );
        Chunks = context.ReceiptTextChunks.Where(chunk =>
            chunk.Embedding != null
            && chunk.EmbeddingModel == model
            && readable.Any(receipt => receipt.Id == chunk.ReceiptId)
        );
        Model = model;
        Vector = vector;
    }

    public IQueryable<ReceiptText> Texts { get; }
    public IQueryable<ReceiptTextChunk> Chunks { get; }
    public string Model { get; }
    public Vector Vector { get; }
}
