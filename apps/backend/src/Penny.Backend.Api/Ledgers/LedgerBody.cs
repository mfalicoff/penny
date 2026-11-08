using System.Text.Json;
using Microsoft.Net.Http.Headers;

namespace Penny.Backend.Api.Ledgers;

// Reads the ledger body the way express.json() fed the legacy validator: a non-JSON
// content type or empty body is "no body" (validation then fails), malformed JSON or
// a top-level scalar is a 400 "Invalid JSON.". The body is never logged.
public static class LedgerBody
{
    public static async Task<JsonDocument?> ReadAsync(
        HttpRequest request,
        CancellationToken cancellationToken
    )
    {
        if (
            !MediaTypeHeaderValue.TryParse(request.ContentType, out var type)
            || !type.MediaType.Equals("application/json", StringComparison.OrdinalIgnoreCase)
        )
            return null;
        using var buffer = new MemoryStream();
        await request.Body.CopyToAsync(buffer, cancellationToken);
        if (buffer.Length == 0)
            return null;
        var document = JsonDocument.Parse(buffer.GetBuffer().AsMemory(0, (int)buffer.Length));
        if (document.RootElement.ValueKind is not (JsonValueKind.Object or JsonValueKind.Array))
        {
            document.Dispose();
            throw new JsonException("Strict JSON bodies must be objects or arrays.");
        }
        return document;
    }
}
