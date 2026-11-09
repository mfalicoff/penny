namespace Penny.Backend.Domain.Search;

// The stored search texts of one result. `Document` joins title, note and category;
// `OwnerDocument` adds the account name and is matched only for the account's owner
// (the payer, for a shared expense). `EmbeddingSource` is what the meaning tier embeds:
// title, note and category, never an account name.
public sealed record SearchDocumentText(
    string Title,
    string Document,
    string OwnerDocument,
    string EmbeddingSource
)
{
    public static SearchDocumentText Build(
        string title,
        string note,
        string category,
        string? account
    ) =>
        new(
            SearchText.Normalize(title),
            SearchText.Normalize(Join(title, note, category)),
            SearchText.Normalize(Join(title, note, category, account ?? "")),
            Collapse(Join(title, note, category))
        );

    // Missing fields are empty; the fields are joined with single spaces and the
    // normalization collapses the resulting runs.
    private static string Join(params string[] fields) => string.Join(' ', fields);

    private static string Collapse(string value) =>
        string.Join(' ', value.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
}
