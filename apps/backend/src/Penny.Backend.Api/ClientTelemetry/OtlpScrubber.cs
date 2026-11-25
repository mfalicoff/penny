using System.Text.Json.Nodes;

namespace Penny.Backend.Api.ClientTelemetry;

// MAZ-129: checks and scrubs OTLP/JSON (traces or logs) from a client: the iOS app's
// export, and the trace part of a Faro payload. Every resource must name the expected
// client service, so a client can never write telemetry that looks like the API's.
// Strings are scrubbed as URLs; log bodies and attributes whose key ends in `message`
// or `stacktrace` are scrubbed as free text.
public static class OtlpScrubber
{
    public const int MaxItems = 2000;

    /// <summary>
    /// Scrubs `root` in place. False when it is not OTLP/JSON of the given signal, names
    /// another service, or holds more than <see cref="MaxItems"/> spans or records.
    /// </summary>
    public static bool Check(JsonObject root, string signal, string service)
    {
        var (resources, scopes, items) = signal switch
        {
            "traces" => ("resourceSpans", "scopeSpans", "spans"),
            "logs" => ("resourceLogs", "scopeLogs", "logRecords"),
            _ => throw new ArgumentOutOfRangeException(nameof(signal)),
        };
        if (root.Count != 1 || root[resources] is not JsonArray list)
            return false;
        var count = 0;
        foreach (var entry in list)
        {
            if (
                entry is not JsonObject resource
                || ServiceName(resource) != service
                || resource[scopes] is not JsonArray scopeList
            )
                return false;
            foreach (var scope in scopeList)
            {
                if (scope is not JsonObject scopeObject)
                    return false;
                if (scopeObject[items] is JsonArray records)
                    count += records.Count;
                else if (scopeObject[items] is not null)
                    return false;
            }
        }
        if (count > MaxItems)
            return false;
        Walk(root, text: false);
        return true;
    }

    private static string? ServiceName(JsonObject resource) =>
        (resource["resource"]?["attributes"] as JsonArray)
            ?.OfType<JsonObject>()
            .Where(attribute =>
                attribute["key"]?.GetValueKind() == System.Text.Json.JsonValueKind.String
                && attribute["key"]!.GetValue<string>() == "service.name"
            )
            .Select(attribute => attribute["value"]?["stringValue"])
            .Select(value =>
                value?.GetValueKind() == System.Text.Json.JsonValueKind.String
                    ? value.GetValue<string>()
                    : null
            )
            .FirstOrDefault();

    private static void Walk(JsonNode? node, bool text)
    {
        switch (node)
        {
            case JsonArray array:
                for (var index = 0; index < array.Count; index++)
                    if (Scrub(array[index], text) is { } scrubbed)
                        array[index] = scrubbed;
                break;
            case JsonObject value:
                // An attribute: { key, value: { stringValue } }.
                var key =
                    value["key"]?.GetValueKind() == System.Text.Json.JsonValueKind.String
                        ? value["key"]!.GetValue<string>()
                        : null;
                var textual =
                    key is not null
                    && (
                        key.EndsWith("message", StringComparison.Ordinal)
                        || key.EndsWith("stacktrace", StringComparison.Ordinal)
                    );
                foreach (var (name, child) in value.ToArray())
                {
                    var childText = text || name == "body" || (name == "value" && textual);
                    if (name == "key")
                        continue;
                    if (Scrub(child, childText) is { } scrubbed)
                        value[name] = scrubbed;
                }
                break;
        }
    }

    // A replacement for a string leaf, or null after walking anything else in place.
    private static JsonNode? Scrub(JsonNode? node, bool text)
    {
        if (node is JsonValue leaf && leaf.GetValueKind() == System.Text.Json.JsonValueKind.String)
        {
            var value = leaf.GetValue<string>();
            return JsonValue.Create(
                text ? TelemetryScrubber.ScrubText(value) : TelemetryScrubber.ScrubUrl(value)
            );
        }
        Walk(node, text);
        return null;
    }
}
