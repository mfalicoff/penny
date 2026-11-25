namespace Penny.Backend.Api.Configuration;

// MAZ-129: opt-in client telemetry, off unless the operator names where it goes. The web
// and iOS apps never talk to the collector: they post to POST /api/telemetry/*, which
// checks, scrubs and forwards from the server, so the collector stays on a private
// network (or behind a key only the server holds, for Grafana Cloud).
//
// * `ClientTelemetry__FaroUrl`: the Faro receiver the web app's reports go to (your
//   Alloy's `faro.receiver`, such as http://alloy:12347/collect, or a Grafana Cloud
//   Frontend Observability collector URL). Unset keeps web telemetry off.
// * `ClientTelemetry__OtlpEndpoint`: the OTLP/HTTP base URL the iOS app's traces and logs
//   go to (`/v1/traces` and `/v1/logs` are appended), with optional
//   `ClientTelemetry__OtlpHeaders` (`key=value,key=value`, for Grafana Cloud's Basic auth).
//   Unset keeps native telemetry off.
// * `ClientTelemetry__SessionReplay=true` lets the web app offer Session Replay (needs
//   FaroUrl; Grafana Cloud only, where replay is enabled per stack).
// * `ClientTelemetry__RateLimitPermits` (per session per minute, default 120) and
//   `ClientTelemetry__MaxPayloadBytes` (default 1 MiB).
//
// URLs and headers can carry keys, so errors name the setting, never the value.
public sealed record ClientTelemetryOptions(
    Uri? FaroUrl,
    Uri? OtlpEndpoint,
    IReadOnlyDictionary<string, string> OtlpHeaders,
    bool SessionReplay,
    int RateLimitPermits,
    int MaxPayloadBytes
)
{
    public const int DefaultMaxPayloadBytes = 1024 * 1024;

    public static ClientTelemetryOptions Disabled { get; } =
        new(null, null, new Dictionary<string, string>(), false, 120, DefaultMaxPayloadBytes);

    public bool WebEnabled => FaroUrl is not null;

    public bool NativeEnabled => OtlpEndpoint is not null;

    public static ClientTelemetryOptions Read(IConfiguration configuration)
    {
        var faro = Url(configuration, "ClientTelemetry:FaroUrl", "ClientTelemetry__FaroUrl");
        var otlp = Url(
            configuration,
            "ClientTelemetry:OtlpEndpoint",
            "ClientTelemetry__OtlpEndpoint"
        );
        var headers = Headers(configuration["ClientTelemetry:OtlpHeaders"]);
        if (headers.Count > 0 && otlp is null)
            throw new InvalidOperationException(
                "ClientTelemetry__OtlpHeaders needs ClientTelemetry__OtlpEndpoint too."
            );
        var replay = configuration["ClientTelemetry:SessionReplay"] switch
        {
            null or "false" => false,
            "true" => true,
            _ => throw new InvalidOperationException(
                "ClientTelemetry__SessionReplay must be true or false."
            ),
        };
        if (replay && faro is null)
            throw new InvalidOperationException(
                "ClientTelemetry__SessionReplay needs ClientTelemetry__FaroUrl (replay is a web feature)."
            );
        return new(
            faro,
            otlp,
            headers,
            replay,
            BackendOptions.ReadBounded(
                configuration,
                "ClientTelemetry:RateLimitPermits",
                120,
                1,
                10_000
            ),
            BackendOptions.ReadBounded(
                configuration,
                "ClientTelemetry:MaxPayloadBytes",
                DefaultMaxPayloadBytes,
                16 * 1024,
                8 * 1024 * 1024
            )
        );
    }

    private static Uri? Url(IConfiguration configuration, string key, string setting)
    {
        var value = configuration[key];
        if (string.IsNullOrWhiteSpace(value))
            return null;
        if (
            !Uri.TryCreate(value.Trim(), UriKind.Absolute, out var url)
            || url.Scheme is not ("http" or "https")
            || url.UserInfo.Length > 0
            || url.Query.Length > 0
            || url.Fragment.Length > 0
        )
            throw new InvalidOperationException(
                $"{setting} must be an absolute http:// or https:// URL without credentials, query or fragment."
            );
        return url;
    }

    // `key=value,key=value`, as OTEL_EXPORTER_OTLP_HEADERS; values may be percent-encoded.
    private static Dictionary<string, string> Headers(string? value)
    {
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(value))
            return headers;
        foreach (var item in value.Split(','))
        {
            var separator = item.IndexOf('=', StringComparison.Ordinal);
            var name = separator < 0 ? "" : item[..separator].Trim();
            if (
                name.Length == 0
                || !name.All(character =>
                    char.IsAsciiLetterOrDigit(character) || character is '-' or '_'
                )
            )
                throw new InvalidOperationException(
                    "ClientTelemetry__OtlpHeaders must be comma-separated key=value pairs."
                );
            headers[name] = Uri.UnescapeDataString(item[(separator + 1)..].Trim());
        }
        return headers;
    }
}
