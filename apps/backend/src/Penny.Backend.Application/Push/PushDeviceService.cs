using System.Text.Json;
using System.Text.RegularExpressions;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Authentication;
using Penny.Backend.Domain.Errors;

namespace Penny.Backend.Application.Push;

// `POST/DELETE /api/push/devices` (MAZ-61). Only
// native iOS registrations are accepted: `provider: "apns"`, `platform: "ios"`, a hex
// device token and the APNs `environment` that issued it. Unknown keys are ignored.
// Every rejection is "Invalid push device.".
public sealed partial class PushDeviceService(IPushRepository devices, TimeProvider clock)
{
    public const string InvalidDevice = "Invalid push device.";

    public Task RegisterAsync(
        AuthenticatedSession session,
        JsonElement? body,
        CancellationToken cancellationToken
    ) =>
        devices.RegisterAsync(
            session.UserId,
            session.TokenHash,
            Parse(body) ?? throw new BackendFailure(FailureKind.Invalid, InvalidDevice),
            clock.GetUtcNow(),
            cancellationToken
        );

    public Task RemoveAsync(
        AuthenticatedSession session,
        JsonElement? body,
        CancellationToken cancellationToken
    )
    {
        if (
            body is not { ValueKind: JsonValueKind.Object } root
            || !root.TryGetProperty("token", out var value)
            || value.ValueKind != JsonValueKind.String
            || TryText(value) is not { } token
        )
            throw new BackendFailure(FailureKind.Invalid, InvalidDevice);
        // Any other token cannot be stored, so it matches nothing.
        if (!ApnsToken().IsMatch(token))
            return Task.CompletedTask;
        return devices.RemoveAsync(
            session.UserId,
            session.TokenHash,
            token.ToLowerInvariant(),
            clock.GetUtcNow(),
            cancellationToken
        );
    }

    public static PushDeviceRegistration? Parse(JsonElement? body)
    {
        if (
            body is not { ValueKind: JsonValueKind.Object } root
            || Field(root, "token") is not { } token
            || Field(root, "platform") != "ios"
            || Field(root, "provider") != PushProviders.Apns
            || Field(root, "environment") is not { } environment
            || environment is not (PushProviders.Sandbox or PushProviders.Production)
            || !ApnsToken().IsMatch(token)
        )
            return null;
        return new(token.ToLowerInvariant(), "ios", PushProviders.Apns, environment);
    }

    private static string? Field(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? TryText(value)
            : null;

    private static string? TryText(JsonElement value)
    {
        try
        {
            return value.GetString();
        }
        catch (InvalidOperationException)
        {
            // An escaped lone surrogate cannot be transcoded.
            return null;
        }
    }

    // APNs device tokens are opaque hex; today 32 bytes, documented as variable.
    [GeneratedRegex("^(?:[0-9A-Fa-f]{2}){32,100}$")]
    private static partial Regex ApnsToken();
}
