using System.Diagnostics;
using OpenTelemetry;

namespace Penny.Backend.Api.Observability;

// MAZ-127: runs on every span before any exporter sees it. Server spans keep the
// route template (`http.route`) and lose the concrete path and query, as the access
// log does. Client spans keep only the origin of `url.full`: APNs puts the device
// token in the path, and provider URLs may carry codes. Any recorded SQL parameter
// is dropped (Npgsql records none; this keeps it that way).
public sealed class RedactingSpanProcessor : BaseProcessor<Activity>
{
    private const string ParameterPrefix = "db.query.parameter.";

    public override void OnEnd(Activity data)
    {
        if (data.Kind == ActivityKind.Server)
        {
            data.SetTag("url.path", null);
            data.SetTag("url.query", null);
        }
        if (data.GetTagItem("url.full") is string full)
            data.SetTag("url.full", Origin(full));
        List<string>? parameters = null;
        foreach (var tag in data.TagObjects)
            if (tag.Key.StartsWith(ParameterPrefix, StringComparison.Ordinal))
                (parameters ??= []).Add(tag.Key);
        foreach (var key in parameters ?? [])
            data.SetTag(key, null);
    }

    public static string? Origin(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var parsed)
            ? parsed.GetLeftPart(UriPartial.Authority)
            : null;
}
