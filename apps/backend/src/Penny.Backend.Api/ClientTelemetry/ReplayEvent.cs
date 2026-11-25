using System.Text.Json;
using System.Text.Json.Nodes;

namespace Penny.Backend.Api.ClientTelemetry;

// MAZ-129: one Session Replay event (an rrweb event, serialized by Faro into the
// `event` attribute of a `faro.session_recording.event`). The web app records with every
// text and input masked; this enforces it again on the server, and also masks the
// attributes rrweb leaves alone (`aria-label`, `title`, `alt`, `placeholder`, ids and
// data attributes can all carry entry titles, names or amounts). What survives is the
// page's structure, classes and styles, which is what a replay needs to show clicks and
// page changes.
public static class ReplayEvent
{
    private const int MaxDepth = 512;

    // Attributes that describe layout or state, never content. Everything else is masked.
    private static readonly HashSet<string> Structural = new(StringComparer.OrdinalIgnoreCase)
    {
        "class",
        "style",
        "rel",
        "type",
        "role",
        "tabindex",
        "lang",
        "dir",
        "charset",
        "media",
        "width",
        "height",
        "viewbox",
        "preserveaspectratio",
        "xmlns",
        "focusable",
        "d",
        "points",
        "transform",
        "cx",
        "cy",
        "r",
        "rx",
        "ry",
        "x",
        "y",
        "x1",
        "y1",
        "x2",
        "y2",
        "fill",
        "stroke",
        "stroke-width",
        "stroke-linecap",
        "stroke-linejoin",
        "stroke-dasharray",
        "opacity",
        "fill-opacity",
        "stroke-opacity",
        "fill-rule",
        "clip-rule",
        "disabled",
        "checked",
        "selected",
        "hidden",
        "open",
        "readonly",
        "required",
        "multiple",
        "aria-hidden",
        "aria-expanded",
        "aria-selected",
        "aria-current",
        "aria-checked",
        "aria-pressed",
        "aria-disabled",
        "aria-haspopup",
        "aria-modal",
        "aria-busy",
        "aria-live",
        "aria-invalid",
        "aria-orientation",
        "colspan",
        "rowspan",
        "autocomplete",
        "inputmode",
        "data-theme",
        "rr_width",
        "rr_height",
        "rr_scrollleft",
        "rr_scrolltop",
        "rr_mediastate",
        "_csstext",
    };

    private static readonly HashSet<string> Links = new(StringComparer.OrdinalIgnoreCase)
    {
        "href",
        "src",
        "xlink:href",
        "action",
        "poster",
    };

    // Strings that are page text or what someone typed.
    private static readonly HashSet<string> Content = new(StringComparer.Ordinal)
    {
        "textContent",
        "text",
        "value",
        "payload",
    };

    /// <summary>The masked event, serialized again; null when it isn't an rrweb event.</summary>
    public static string? Mask(string serialized)
    {
        JsonNode? root;
        try
        {
            root = JsonNode.Parse(
                serialized,
                documentOptions: new JsonDocumentOptions { MaxDepth = MaxDepth }
            );
        }
        catch (JsonException)
        {
            return null;
        }
        if (
            root is not JsonObject { } rrweb
            || rrweb["type"] is not JsonValue type
            || !type.TryGetValue<int>(out _)
        )
            return null;
        Walk(rrweb);
        return rrweb.ToJsonString();
    }

    private static void Walk(JsonNode? node)
    {
        switch (node)
        {
            case JsonArray array:
                foreach (var item in array)
                    Walk(item);
                break;
            case JsonObject value:
                var style =
                    value["isStyle"] is JsonValue flag
                    && flag.TryGetValue<bool>(out var isStyle)
                    && isStyle;
                foreach (var (name, child) in value.ToArray())
                {
                    if (name == "attributes" && child is JsonObject attributes)
                        Attributes(attributes);
                    else if (child is JsonValue leaf && leaf.TryGetValue<string>(out var text))
                        value[name] = name switch
                        {
                            "textContent" when style => text,
                            _ when Content.Contains(name) => TelemetryScrubber.Mask(text),
                            "href" => TelemetryScrubber.ScrubUrl(text),
                            _ => text,
                        };
                    else if (name == "payload")
                        value[name] = null;
                    else
                        Walk(child);
                }
                break;
        }
    }

    private static void Attributes(JsonObject attributes)
    {
        foreach (var (name, child) in attributes.ToArray())
        {
            if (child is not JsonValue leaf || !leaf.TryGetValue<string>(out var text))
                continue; // null (removed) or a style diff object.
            if (Structural.Contains(name))
                continue;
            // Inline images (a receipt preview, a picture) are content too.
            attributes[name] = Links.Contains(name)
                ? text.StartsWith("data:", StringComparison.OrdinalIgnoreCase)
                    ? "data:,"
                    : TelemetryScrubber.ScrubUrl(text)
                : TelemetryScrubber.Mask(text);
        }
    }
}
