using System.Text.Json;
using Microsoft.Net.Http.Headers;
using Penny.Backend.Application.Profiles;
using Penny.Backend.Domain.Errors;

namespace Penny.Backend.Api.Profiles;

// Reads `PATCH /api/profile`: a JSON object whose `displayName` is a string (set) or null
// (clear) and whose `namePromptDismissed` is `true`. A missing field changes nothing;
// any other type is a 400, so a client bug never clears a name.
public static class ProfilePatchBody
{
    public const string InvalidBody =
        "Send displayName as a string or null, and namePromptDismissed as true.";

    public static async Task<(Optional<string?> Name, bool DismissPrompt)> ReadAsync(
        HttpRequest request,
        CancellationToken cancellationToken
    )
    {
        if (
            !MediaTypeHeaderValue.TryParse(request.ContentType, out var type)
            || !type.MediaType.Equals("application/json", StringComparison.OrdinalIgnoreCase)
        )
            throw new BackendFailure(
                FailureKind.Invalid,
                ErrorCodes.ProfileInvalidBody,
                InvalidBody
            );
        using var buffer = new MemoryStream();
        await request.Body.CopyToAsync(buffer, cancellationToken);
        using var document = JsonDocument.Parse(buffer.ToArray());
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
            throw new BackendFailure(
                FailureKind.Invalid,
                ErrorCodes.ProfileInvalidBody,
                InvalidBody
            );
        var name = Optional<string?>.Absent;
        if (root.TryGetProperty("displayName", out var value))
            name = value.ValueKind switch
            {
                JsonValueKind.String => Optional<string?>.Of(value.GetString()),
                JsonValueKind.Null => Optional<string?>.Of(null),
                _ => throw new BackendFailure(
                    FailureKind.Invalid,
                    ErrorCodes.ProfileInvalidBody,
                    InvalidBody
                ),
            };
        var dismiss = false;
        if (root.TryGetProperty("namePromptDismissed", out var flag))
            dismiss =
                flag.ValueKind == JsonValueKind.True
                    ? true
                    : throw new BackendFailure(
                        FailureKind.Invalid,
                        ErrorCodes.ProfileInvalidBody,
                        InvalidBody
                    );
        return (name, dismiss);
    }
}
