using System.Text.Json;
using System.Text.RegularExpressions;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Authentication;
using Penny.Backend.Domain.Errors;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Application.Push;

// `POST/DELETE /api/push/devices` (legacy server/application/push.ts, MAZ-61). A body
// without `provider` is a legacy Expo registration; `provider: "apns"` registers a
// native iOS device token with the APNs `environment` that issued it. Unknown keys
// are ignored, as zod did. Every rejection is the legacy "Invalid push device.".
public sealed partial class PushDeviceService(
    IPushRepository devices,
    PushSettings settings,
    TimeProvider clock
)
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
        // Unknown or unstorable tokens match nothing, as in SQLite.
        if (!LedgerText.IsStorable(token))
            return Task.CompletedTask;
        return devices.RemoveAsync(
            session.UserId,
            session.TokenHash,
            ApnsToken().IsMatch(token) ? token.ToLowerInvariant() : token,
            clock.GetUtcNow(),
            cancellationToken
        );
    }

    public PushDeviceRegistration? Parse(JsonElement? body)
    {
        if (
            body is not { ValueKind: JsonValueKind.Object } root
            || Field(root, "token") is not { } token
        )
            return null;
        var platform = Field(root, "platform");
        if (platform is not ("ios" or "android"))
            return null;
        var provider = root.TryGetProperty("provider", out var providerValue)
            ? providerValue.ValueKind == JsonValueKind.String
                ? providerValue.GetString()
                : null
            : PushProviders.Expo;
        var hasEnvironment =
            root.TryGetProperty("environment", out var environmentValue)
            && environmentValue.ValueKind != JsonValueKind.Null;
        if (provider == PushProviders.Expo)
            return settings.ExpoEnabled && !hasEnvironment && ExpoToken().IsMatch(token)
                ? new(token, platform, PushProviders.Expo, null)
                : null;
        if (provider != PushProviders.Apns || platform != "ios" || !hasEnvironment)
            return null;
        var environment =
            environmentValue.ValueKind == JsonValueKind.String
                ? environmentValue.GetString()
                : null;
        if (
            environment is not (PushProviders.Sandbox or PushProviders.Production)
            || !ApnsToken().IsMatch(token)
        )
            return null;
        return new(token.ToLowerInvariant(), platform, PushProviders.Apns, environment);
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

    [GeneratedRegex(@"^(?:Expo|Exponent)PushToken\[[A-Za-z0-9_-]{1,180}\]$")]
    private static partial Regex ExpoToken();

    // APNs device tokens are opaque hex; today 32 bytes, documented as variable.
    [GeneratedRegex("^(?:[0-9A-Fa-f]{2}){32,100}$")]
    private static partial Regex ApnsToken();
}
