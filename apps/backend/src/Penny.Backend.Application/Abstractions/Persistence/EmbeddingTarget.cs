namespace Penny.Backend.Application.Abstractions.Persistence;

// Which embedding outbox a row belongs to: a search document (title, note and
// category) or a chunk of a receipt's extracted text (MAZ-125). They are stored apart
// because a receipt can be more private than the entry it is attached to.
public enum EmbeddingTarget
{
    Document,
    ReceiptChunk,
}
