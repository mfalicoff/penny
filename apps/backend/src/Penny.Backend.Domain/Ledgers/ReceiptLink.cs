namespace Penny.Backend.Domain.Ledgers;

// The receipt embedded in an entry. Only the id is client-owned: name and MIME are
// served from the uploaded receipt row and the URI is the canonical download path
// the legacy upload response returned.
public sealed record ReceiptLink(string Id, string Name, string Mime, string Uri)
{
    public static string UriFor(string id) => "/api/receipts/" + System.Uri.EscapeDataString(id);
}
