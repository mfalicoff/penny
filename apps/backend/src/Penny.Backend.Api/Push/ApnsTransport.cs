using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Penny.Backend.Application.Push;

namespace Penny.Backend.Api.Push;

// Native APNs delivery over HTTP/2 with token authentication (MAZ-61). Each message
// is one `POST /3/device/{token}` to the gateway named by the device's environment
// (sandbox tokens never go to production and vice versa). Requests carry the
// outbox id as `apns-collapse-id` (an at-least-once duplicate replaces the earlier
// banner), a stable `apns-id` per delivery, and `apns-expiration` at the message's
// MaxAge. Outcomes are redacted reason codes (`apns:<status>:<reason>`); tokens,
// payloads, JWTs and response bodies are never logged or stored.
public sealed partial class ApnsTransport(
    HttpClient http,
    ApnsCredentials credentials,
    ApnsProviderToken tokens,
    ILogger<ApnsTransport> logger
) : IPushTransport
{
    public const string HttpClientName = "apns";
    public const string ProductionHost = "https://api.push.apple.com";
    public const string SandboxHost = "https://api.sandbox.push.apple.com";
    public const int MaxConcurrency = 8;

    public string Provider => PushProviders.Apns;

    public async Task<IReadOnlyList<PushOutcome>> SendAsync(
        IReadOnlyList<PushMessage> messages,
        CancellationToken cancellationToken
    )
    {
        using var slots = new SemaphoreSlim(MaxConcurrency);
        var sends = messages.Select(async message =>
        {
            await slots.WaitAsync(cancellationToken);
            try
            {
                return await SendOneAsync(message, cancellationToken);
            }
            finally
            {
                slots.Release();
            }
        });
        return await Task.WhenAll(sends);
    }

    // The JSON body: `aps` plus the household deep-link keys at the top level.
    public static byte[] Body(PushMessage message)
    {
        var body = new JsonObject
        {
            ["aps"] = new JsonObject
            {
                ["alert"] = new JsonObject { ["title"] = message.Title, ["body"] = message.Body },
                ["sound"] = "default",
                ["thread-id"] = $"household-{message.Payload.HouseholdId}",
            },
        };
        foreach (var (key, value) in message.Payload.ToDictionary())
            body[key] = value;
        return JsonSerializer.SerializeToUtf8Bytes(body);
    }

    // A stable UUID per (message, device), so retries share Apple's diagnostic id.
    public static string NotificationId(PushMessage message)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes($"{message.OutboxId}:{message.Token}"));
        return new Guid(hash.AsSpan(0, 16), bigEndian: true).ToString("D");
    }

    // Maps an APNs error status and `reason` to an outcome. Token errors remove the
    // device; provider-configuration errors retry (fixing the configuration delivers
    // messages younger than MaxAge) and are logged.
    public static PushOutcome Classify(HttpStatusCode status, string? reason, TimeSpan? retryAfter)
    {
        var code = $"apns:{(int)status}:{reason ?? "unknown"}";
        return ((int)status, reason) switch
        {
            (410, _) => PushOutcome.InvalidToken(code),
            (400, "BadDeviceToken") => PushOutcome.InvalidToken(code),
            (
                400
                    or 403,
                "BadTopic"
                    or "TopicDisallowed"
                    or "MissingTopic"
                    or "DeviceTokenNotForTopic"
                    or "BadCertificate"
                    or "BadCertificateEnvironment"
                    or "ExpiredProviderToken"
                    or "InvalidProviderToken"
                    or "MissingProviderToken"
                    or "Forbidden"
            ) => PushOutcome.Retry(code, retryAfter),
            (429, _) => PushOutcome.Retry(code, retryAfter),
            (>= 500, _) => PushOutcome.Retry(code, retryAfter),
            _ => PushOutcome.Permanent(code),
        };
    }

    public static bool IsConfigurationError(string? reason) =>
        reason
            is "BadTopic"
                or "TopicDisallowed"
                or "MissingTopic"
                or "DeviceTokenNotForTopic"
                or "BadCertificate"
                or "BadCertificateEnvironment"
                or "InvalidProviderToken"
                or "MissingProviderToken"
                or "Forbidden";

    private async Task<PushOutcome> SendOneAsync(
        PushMessage message,
        CancellationToken cancellationToken
    )
    {
        var host = message.Environment == PushProviders.Sandbox ? SandboxHost : ProductionHost;
        var jwt = tokens.Current();
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"{host}/3/device/{message.Token}"
        )
        {
            Version = HttpVersion.Version20,
            VersionPolicy = HttpVersionPolicy.RequestVersionExact,
            Content = new ByteArrayContent(Body(message)),
        };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        request.Headers.Authorization = new AuthenticationHeaderValue("bearer", jwt);
        request.Headers.TryAddWithoutValidation("apns-topic", credentials.Topic);
        request.Headers.TryAddWithoutValidation("apns-push-type", "alert");
        request.Headers.TryAddWithoutValidation("apns-priority", "10");
        request.Headers.TryAddWithoutValidation("apns-id", NotificationId(message));
        request.Headers.TryAddWithoutValidation("apns-collapse-id", message.CollapseId);
        request.Headers.TryAddWithoutValidation(
            "apns-expiration",
            message.ExpiresAt.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture)
        );
        HttpResponseMessage response;
        try
        {
            response = await http.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                cancellationToken
            );
        }
        catch (HttpRequestException)
        {
            return PushOutcome.Retry("apns:network");
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return PushOutcome.Retry("apns:timeout");
        }
        using (response)
        {
            if (response.StatusCode == HttpStatusCode.OK)
                return PushOutcome.Accepted(
                    response.Headers.TryGetValues("apns-id", out var ids)
                        ? ids.FirstOrDefault()
                        : NotificationId(message)
                );
            var reason = await ReasonAsync(response, cancellationToken);
            if (reason == "ExpiredProviderToken")
                tokens.Expire(jwt);
            if (IsConfigurationError(reason))
                ConfigurationRejected(logger, (int)response.StatusCode, reason!);
            return Classify(response.StatusCode, reason, RetryAfter(response));
        }
    }

    private static async Task<string?> ReasonAsync(
        HttpResponseMessage response,
        CancellationToken cancellationToken
    )
    {
        try
        {
            var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);
            if (bytes.Length is 0 or > 4096)
                return null;
            using var document = JsonDocument.Parse(bytes);
            return
                document.RootElement.ValueKind == JsonValueKind.Object
                && document.RootElement.TryGetProperty("reason", out var value)
                && value.ValueKind == JsonValueKind.String
                && value.GetString() is { } reason
                && ReasonCode().IsMatch(reason)
                ? reason
                : null;
        }
        catch (Exception error) when (error is JsonException or HttpRequestException)
        {
            return null;
        }
    }

    internal static TimeSpan? RetryAfter(HttpResponseMessage response) =>
        response.Headers.RetryAfter switch
        {
            { Delta: { } delta } => delta,
            { Date: { } date } => date - DateTimeOffset.UtcNow,
            _ => null,
        };

    [GeneratedRegex("^[A-Za-z]{1,64}$")]
    private static partial Regex ReasonCode();

    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "APNs rejected the provider configuration ({Status} {Reason}); check Push__Apns__* settings. Deliveries are retried until they expire"
    )]
    private static partial void ConfigurationRejected(ILogger logger, int status, string reason);
}
