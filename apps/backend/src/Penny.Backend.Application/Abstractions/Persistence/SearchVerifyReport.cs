namespace Penny.Backend.Application.Abstractions.Persistence;

// `search-verify`: counts of documents that disagree with the source rows. All zero
// means stored text, visibility keys and embeddings are current.
public sealed record SearchVerifyReport(
    long Documents,
    long Missing,
    long Orphaned,
    long StaleText,
    long PendingEmbeddings,
    long StaleModel
)
{
    public bool Clean => Missing + Orphaned + StaleText + PendingEmbeddings + StaleModel == 0;
}
