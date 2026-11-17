namespace Penny.Backend.Api.Contracts;

// The download's Content-Disposition (MAZ-131): an RFC 8187 `filename*` with every byte
// outside the RFC 3986 unreserved set (`A–Z a–z 0–9 - . _ ~`) percent-encoded as UTF-8
// with uppercase hex. Names are storable text, so they never hold a lone surrogate.
public static class ReceiptDisposition
{
    public static string Inline(string name) =>
        "inline; filename*=UTF-8''" + Uri.EscapeDataString(name);
}
