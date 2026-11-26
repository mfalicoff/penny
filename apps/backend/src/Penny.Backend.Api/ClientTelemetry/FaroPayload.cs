using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Penny.Backend.Api.ClientTelemetry;

// MAZ-129: the schema check and server-side scrub of one Grafana Faro Web SDK request
// (`{ meta, exceptions, logs, measurements, events, traces }`). A payload that isn't
// shaped like that, or claims another app, is refused; inside a valid one, the user and
// location are dropped, URLs and messages are scrubbed again, and Session Replay events
// are re-masked (ReplayEvent), or dropped when the server doesn't offer replay.
public static partial class FaroPayload
{
    public const string App = "penny-web";
    public const string ReplayEventPrefix = "faro.session_recording.";
    public const string ReplayEvent = "faro.session_recording.event";
    public const int MaxItems = 1000;

    private static readonly string[] Lists = ["exceptions", "logs", "measurements", "events"];

    // Meta that describes the app, page and browser; `user`, `geo` and anything new are dropped.
    private static readonly HashSet<string> MetaKeys =
    [
        "sdk",
        "app",
        "session",
        "page",
        "browser",
        "view",
    ];

    // Free text (an exception value, a log message, a measurement context), scrubbed as text
    // rather than as URLs. Event attributes stay URLs-only: Faro puts timings in them as strings.
    private static readonly HashSet<string> TextKeys = ["message", "value", "context"];

    [GeneratedRegex("^[A-Za-z0-9_-]{1,64}$", RegexOptions.CultureInvariant)]
    private static partial Regex Token();

    // Grafana Cloud's Faro collector refuses a request without the session id in this header
    // (400 "missing X-Faro-Session-Id header"); the browser SDK sets it, so the forwarder must too.
    public const string SessionHeader = "X-Faro-Session-Id";

    /// <summary>A checked payload's session id when it is a short token, else null.</summary>
    public static string? SessionId(JsonObject payload) =>
        payload["meta"]?["session"]?["id"] is JsonValue id
        && id.GetValueKind() == JsonValueKind.String
        && Token().IsMatch(id.GetValue<string>())
            ? id.GetValue<string>()
            : null;

    /// <summary>The payload to forward, scrubbed; null when it fails the schema check.</summary>
    public static JsonObject? Check(JsonNode? body, bool replay)
    {
        if (body is not JsonObject root)
            return null;
        if (
            root.Any(property =>
                property.Key != "meta" && property.Key != "traces" && !Lists.Contains(property.Key)
            )
        )
            return null;
        if (
            root["meta"] is not JsonObject meta
            || meta["app"] is not JsonObject app
            || app["name"]?.GetValueKind() != JsonValueKind.String
            || app["name"]!.GetValue<string>() != App
        )
            return null;
        foreach (var key in meta.Select(property => property.Key).ToArray())
            if (!MetaKeys.Contains(key))
                meta.Remove(key);

        var items = 0;
        foreach (var name in Lists)
        {
            if (root[name] is null)
                continue;
            if (root[name] is not JsonArray list || list.Any(item => item is not JsonObject))
                return null;
            items += list.Count;
        }
        if (items > MaxItems)
            return null;
        // Exception and log context is free-form, set by app code next to an error, where page text
        // is most likely to end up; the app sets none, so it is dropped rather than trusted.
        foreach (var name in new[] { "exceptions", "logs" })
            if (root[name] is JsonArray list)
                foreach (var item in list)
                    ((JsonObject)item!).Remove("context");
        if (root["traces"] is JsonNode traces)
        {
            if (traces is not JsonObject otlp || !OtlpScrubber.Check(otlp, "traces", App))
                return null;
        }

        var checkedReplay = new HashSet<JsonObject>(ReferenceEqualityComparer.Instance);
        if (root["events"] is JsonArray events && !Replay(events, replay, checkedReplay))
            return null;
        foreach (var (name, child) in root.ToArray())
            if (name != "traces")
                Walk(child, text: false, checkedReplay);
        return root;
    }

    // Re-masks (or drops) replay events in place. False when one is malformed.
    private static bool Replay(JsonArray events, bool replay, HashSet<JsonObject> checkedReplay)
    {
        for (var index = events.Count - 1; index >= 0; index--)
        {
            var item = (JsonObject)events[index]!;
            var name =
                item["name"]?.GetValueKind() == JsonValueKind.String
                    ? item["name"]!.GetValue<string>()
                    : "";
            if (!name.StartsWith(ReplayEventPrefix, StringComparison.Ordinal))
                continue;
            if (!replay)
            {
                events.RemoveAt(index);
                continue;
            }
            if (item["attributes"] is not JsonObject attributes)
                return false;
            foreach (var (key, value) in attributes.ToArray())
            {
                if (value?.GetValueKind() != JsonValueKind.String)
                    return false;
                var text = value.GetValue<string>();
                if (key == "event" && name == ReplayEvent)
                {
                    if (ClientTelemetry.ReplayEvent.Mask(text) is not { } masked)
                        return false;
                    attributes[key] = masked;
                }
                else if (key is "recording_id" or "gen" or "seq")
                {
                    if (!Token().IsMatch(text))
                        return false;
                }
                else
                    attributes.Remove(key);
            }
            checkedReplay.Add(item);
        }
        return true;
    }

    private static void Walk(JsonNode? node, bool text, HashSet<JsonObject> checkedReplay)
    {
        switch (node)
        {
            case JsonArray array:
                for (var index = 0; index < array.Count; index++)
                    if (Scrub(array[index], text) is { } scrubbed)
                        array[index] = scrubbed;
                    else
                        Walk(array[index], text, checkedReplay);
                break;
            case JsonObject value:
                // Replay attributes were checked and masked already (Replay).
                var replayEvent = checkedReplay.Contains(value);
                foreach (var (name, child) in value.ToArray())
                {
                    if (replayEvent && name == "attributes")
                        continue;
                    var childText = text || TextKeys.Contains(name);
                    if (Scrub(child, childText) is { } scrubbed)
                        value[name] = scrubbed;
                    else
                        Walk(child, childText, checkedReplay);
                }
                break;
        }
    }

    private static JsonValue? Scrub(JsonNode? node, bool text) =>
        node is JsonValue leaf && leaf.GetValueKind() == JsonValueKind.String
            ? JsonValue.Create(
                text
                    ? TelemetryScrubber.ScrubText(leaf.GetValue<string>())
                    : TelemetryScrubber.ScrubUrl(leaf.GetValue<string>())
            )
            : null;
}
