namespace Penny.Backend.Persistence.Search;

// Receipts whose links from search documents changed in one write (MAZ-125): `Gained`
// are newly linked by a document, `Released` lost a document (unlinked, replaced or the
// entry or expense deleted). ReceiptTextIndex applies them before commit.
internal sealed class ReceiptLinks
{
    public HashSet<string> Gained { get; } = new(StringComparer.Ordinal);
    public HashSet<string> Released { get; } = new(StringComparer.Ordinal);

    public void Change(string? before, string? after)
    {
        if (string.Equals(before, after, StringComparison.Ordinal))
            return;
        if (before is not null)
            Released.Add(before);
        if (after is not null)
            Gained.Add(after);
    }
}
