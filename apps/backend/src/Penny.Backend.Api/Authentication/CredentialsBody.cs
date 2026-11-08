using System.Text.Json;
using Microsoft.Net.Http.Headers;

namespace Penny.Backend.Api.Authentication;

// Reads `{email, password}` the way express.json() fed the legacy validator:
// non-JSON or empty bodies become `{}`, malformed JSON is a 400 "Invalid JSON.", and
// non-string fields are treated as missing so validation, not binding, decides.
public static class CredentialsBody
{
    public static async Task<(string? Email, string? Password)> ReadAsync(
        HttpRequest request,
        CancellationToken cancellationToken
    )
    {
        if (
            !MediaTypeHeaderValue.TryParse(request.ContentType, out var type)
            || !type.MediaType.Equals("application/json", StringComparison.OrdinalIgnoreCase)
        )
            return (null, null);
        using var buffer = new MemoryStream();
        await request.Body.CopyToAsync(buffer, cancellationToken);
        if (buffer.Length == 0)
            return (null, null);
        using var document = JsonDocument.Parse(buffer.ToArray());
        var root = document.RootElement;
        if (root.ValueKind is not (JsonValueKind.Object or JsonValueKind.Array))
            throw new JsonException("Strict JSON bodies must be objects or arrays.");
        return root.ValueKind == JsonValueKind.Object
            ? (Text(root, "email"), Text(root, "password"))
            : (null, null);
    }

    private static string? Text(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
}
