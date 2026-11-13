using System.Text.Json;
using Microsoft.Net.Http.Headers;

namespace Penny.Backend.Api.Authentication;

// Reads top-level string fields of a JSON body:
// non-JSON or empty bodies become `{}`, malformed JSON is a 400 "Invalid JSON.", and
// non-string fields are treated as missing so validation, not binding, decides.
public static class JsonStringFields
{
    public static async Task<string?[]> ReadAsync(
        HttpRequest request,
        IReadOnlyList<string> names,
        CancellationToken cancellationToken
    )
    {
        var values = new string?[names.Count];
        if (
            !MediaTypeHeaderValue.TryParse(request.ContentType, out var type)
            || !type.MediaType.Equals("application/json", StringComparison.OrdinalIgnoreCase)
        )
            return values;
        using var buffer = new MemoryStream();
        await request.Body.CopyToAsync(buffer, cancellationToken);
        if (buffer.Length == 0)
            return values;
        using var document = JsonDocument.Parse(buffer.ToArray());
        var root = document.RootElement;
        if (root.ValueKind is not (JsonValueKind.Object or JsonValueKind.Array))
            throw new JsonException("Strict JSON bodies must be objects or arrays.");
        if (root.ValueKind == JsonValueKind.Object)
            for (var index = 0; index < names.Count; index++)
                values[index] =
                    root.TryGetProperty(names[index], out var value)
                    && value.ValueKind == JsonValueKind.String
                        ? value.GetString()
                        : null;
        return values;
    }
}
