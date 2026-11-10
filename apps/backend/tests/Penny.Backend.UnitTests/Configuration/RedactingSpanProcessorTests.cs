using System.Diagnostics;
using Penny.Backend.Api.Observability;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Configuration;

public sealed class RedactingSpanProcessorTests : IDisposable
{
    private readonly ActivitySource source = new("Penny.UnitTests.Redaction");
    private readonly ActivityListener listener;

    public RedactingSpanProcessorTests()
    {
        listener = new ActivityListener
        {
            ShouldListenTo = candidate => candidate == source,
            Sample = (ref ActivityCreationOptions<ActivityContext> _) =>
                ActivitySamplingResult.AllDataAndRecorded,
        };
        ActivitySource.AddActivityListener(listener);
    }

    public void Dispose()
    {
        listener.Dispose();
        source.Dispose();
    }

    [Fact]
    public void whenServerSpanEnds_OnEnd_ShouldKeepRouteTemplateAndDropPathAndQuery()
    {
        using var span = source.StartActivity("GET api/households/{id}", ActivityKind.Server)!;
        span.SetTag("http.route", "api/households/{id}");
        span.SetTag("url.path", "/api/households/hh-private");
        span.SetTag("url.query", "?note=private");
        new RedactingSpanProcessor().OnEnd(span);
        span.GetTagItem("http.route").ShouldBe("api/households/{id}");
        span.GetTagItem("url.path").ShouldBeNull();
        span.GetTagItem("url.query").ShouldBeNull();
    }

    [Fact]
    public void whenClientSpanCarriesDeviceToken_OnEnd_ShouldKeepOnlyOrigin()
    {
        using var span = source.StartActivity("POST", ActivityKind.Client)!;
        span.SetTag("url.full", "https://api.push.apple.com:443/3/device/0123abcdef?x=1");
        span.SetTag("db.query.parameter.p1", "private");
        new RedactingSpanProcessor().OnEnd(span);
        span.GetTagItem("url.full").ShouldBe("https://api.push.apple.com");
        span.GetTagItem("db.query.parameter.p1").ShouldBeNull();
    }
}
