using System.Diagnostics;
using System.Globalization;
using OpenTelemetry.Trace;

namespace Penny.Backend.Api.Observability;

// MAZ-129: the web app sends W3C `traceparent` on its API calls so a slow page links to the
// API's spans. That header comes from an untrusted client, so it must not decide sampling:
// a request continuing a remote trace is sampled by the server's own rule (the
// OTEL_TRACES_SAMPLER root: always on, always off or a trace id ratio), whatever the
// client's `sampled` flag says. Spans with a local parent follow it as usual, so a trace
// is never cut in half inside the API.
public sealed class ClientParentSampler(Sampler root) : Sampler
{
    public static ClientParentSampler From(IConfiguration configuration)
    {
        var ratio = double.TryParse(
            configuration["OTEL_TRACES_SAMPLER_ARG"],
            NumberStyles.Float,
            CultureInfo.InvariantCulture,
            out var parsed
        )
            ? parsed
            : 1.0;
        Sampler root = configuration["OTEL_TRACES_SAMPLER"] switch
        {
            "always_off" or "parentbased_always_off" => new AlwaysOffSampler(),
            "traceidratio" or "parentbased_traceidratio" => new TraceIdRatioBasedSampler(ratio),
            _ => new AlwaysOnSampler(),
        };
        return new ClientParentSampler(root);
    }

    public override SamplingResult ShouldSample(in SamplingParameters samplingParameters)
    {
        var parent = samplingParameters.ParentContext;
        if (parent.TraceId == default || parent.IsRemote)
            return root.ShouldSample(samplingParameters);
        return new SamplingResult(
            (parent.TraceFlags & ActivityTraceFlags.Recorded) != 0
                ? SamplingDecision.RecordAndSample
                : SamplingDecision.Drop
        );
    }
}
