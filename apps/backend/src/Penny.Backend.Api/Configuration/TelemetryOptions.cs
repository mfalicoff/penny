using System.Globalization;

namespace Penny.Backend.Api.Configuration;

// MAZ-127: OpenTelemetry is configured only with the standard `OTEL_*` environment
// variables, which the SDK itself reads. This type decides whether telemetry is on
// (an OTLP endpoint is set and OTEL_SDK_DISABLED is not true) and validates the
// settings first, so a typo stops the host before it listens. Messages name the
// setting, never its value: headers and endpoints can carry credentials.
public sealed record TelemetryOptions(bool Enabled, string ServiceName)
{
    public const string DefaultServiceName = "penny-backend";
    public const string Endpoint = "OTEL_EXPORTER_OTLP_ENDPOINT";

    private static readonly string[] Signals = ["", "TRACES_", "METRICS_", "LOGS_"];
    private static readonly string[] Protocols = ["grpc", "http/protobuf"];
    private static readonly string[] Samplers =
    [
        "always_on",
        "always_off",
        "traceidratio",
        "parentbased_always_on",
        "parentbased_always_off",
        "parentbased_traceidratio",
    ];

    public static TelemetryOptions Disabled { get; } = new(false, DefaultServiceName);

    public static TelemetryOptions Read(IConfiguration configuration)
    {
        var disabled = configuration["OTEL_SDK_DISABLED"];
        if (disabled is not null && !bool.TryParse(disabled, out _))
            throw Invalid("OTEL_SDK_DISABLED", "must be true or false");
        if (bool.TryParse(disabled, out var off) && off)
            return Disabled;

        foreach (var signal in Signals)
        {
            var prefix = $"OTEL_EXPORTER_OTLP_{signal}";
            Url(configuration, prefix + "ENDPOINT");
            OneOf(configuration, prefix + "PROTOCOL", Protocols);
            Pairs(configuration, prefix + "HEADERS");
            Positive(configuration, prefix + "TIMEOUT");
        }
        if (configuration[Endpoint] is null)
        {
            foreach (var signal in Signals[1..])
                if (configuration[$"OTEL_EXPORTER_OTLP_{signal}ENDPOINT"] is not null)
                    throw Invalid(
                        $"OTEL_EXPORTER_OTLP_{signal}ENDPOINT",
                        $"needs {Endpoint} too (it turns telemetry on for every signal)"
                    );
            return Disabled;
        }

        var sampler = OneOf(configuration, "OTEL_TRACES_SAMPLER", Samplers);
        if (configuration["OTEL_TRACES_SAMPLER_ARG"] is { } ratio)
        {
            if (sampler is null || !sampler.EndsWith("traceidratio", StringComparison.Ordinal))
                throw Invalid("OTEL_TRACES_SAMPLER_ARG", "needs a traceidratio sampler");
            if (
                !double.TryParse(
                    ratio,
                    NumberStyles.Float,
                    CultureInfo.InvariantCulture,
                    out var parsed
                ) || parsed is < 0 or > 1
            )
                throw Invalid("OTEL_TRACES_SAMPLER_ARG", "must be a number between 0 and 1");
        }
        Positive(configuration, "OTEL_METRIC_EXPORT_INTERVAL");
        Positive(configuration, "OTEL_BSP_SCHEDULE_DELAY");
        Positive(configuration, "OTEL_BLRP_SCHEDULE_DELAY");
        var resource = Pairs(configuration, "OTEL_RESOURCE_ATTRIBUTES");
        var name = configuration["OTEL_SERVICE_NAME"];
        if (name is not null && string.IsNullOrWhiteSpace(name))
            throw Invalid("OTEL_SERVICE_NAME", "must not be blank");
        return new(true, name ?? resource.GetValueOrDefault("service.name") ?? DefaultServiceName);
    }

    private static void Url(IConfiguration configuration, string key)
    {
        if (configuration[key] is not { } value)
            return;
        if (
            !Uri.TryCreate(value, UriKind.Absolute, out var url)
            || url.Scheme is not ("http" or "https")
            || url.UserInfo.Length > 0
            || url.Query.Length > 0
            || url.Fragment.Length > 0
        )
            throw Invalid(
                key,
                "must be an absolute http:// or https:// URL without credentials, query or fragment"
            );
    }

    private static string? OneOf(IConfiguration configuration, string key, string[] allowed)
    {
        var value = configuration[key];
        if (value is not null && !allowed.Contains(value, StringComparer.Ordinal))
            throw Invalid(key, $"must be one of {string.Join(", ", allowed)}");
        return value;
    }

    private static void Positive(IConfiguration configuration, string key)
    {
        if (
            configuration[key] is { } value
            && (
                !int.TryParse(
                    value,
                    NumberStyles.None,
                    CultureInfo.InvariantCulture,
                    out var parsed
                )
                || parsed < 1
            )
        )
            throw Invalid(key, "must be a positive whole number of milliseconds");
    }

    // W3C baggage-style `key=value,key=value` lists (headers, resource attributes).
    private static Dictionary<string, string> Pairs(IConfiguration configuration, string key)
    {
        var pairs = new Dictionary<string, string>(StringComparer.Ordinal);
        if (configuration[key] is not { } value)
            return pairs;
        foreach (var item in value.Split(','))
        {
            var separator = item.IndexOf('=', StringComparison.Ordinal);
            var name = separator < 0 ? "" : item[..separator].Trim();
            if (name.Length == 0 || name.Any(character => char.IsWhiteSpace(character)))
                throw Invalid(key, "must be comma-separated key=value pairs");
            pairs[name] = Uri.UnescapeDataString(item[(separator + 1)..].Trim());
        }
        return pairs;
    }

    private static InvalidOperationException Invalid(string key, string rule) =>
        new($"{key} {rule}.");
}
