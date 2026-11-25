using System.Diagnostics;
using Microsoft.Extensions.Configuration;
using OpenTelemetry.Trace;
using Penny.Backend.Api.Observability;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Observability;

// MAZ-129: a client's traceparent links traces but never decides sampling.
public sealed class ClientParentSamplerTests
{
    private static ClientParentSampler Sampler(string? sampler = null) =>
        ClientParentSampler.From(
            new ConfigurationBuilder()
                .AddInMemoryCollection(
                    sampler is null
                        ? []
                        : [new KeyValuePair<string, string?>("OTEL_TRACES_SAMPLER", sampler)]
                )
                .Build()
        );

    private static SamplingDecision Decide(ClientParentSampler sampler, bool remote, bool sampled)
    {
        var parent = new ActivityContext(
            ActivityTraceId.CreateRandom(),
            ActivitySpanId.CreateRandom(),
            sampled ? ActivityTraceFlags.Recorded : ActivityTraceFlags.None,
            isRemote: remote
        );
        return sampler
            .ShouldSample(
                new SamplingParameters(
                    parent,
                    parent.TraceId,
                    "GET api/ledger",
                    ActivityKind.Server
                )
            )
            .Decision;
    }

    [Fact]
    public void whenClientSaysNotSampled_ShouldSample_ShouldStillFollowTheServerRule() =>
        Decide(Sampler(), remote: true, sampled: false).ShouldBe(SamplingDecision.RecordAndSample);

    [Fact]
    public void whenClientSaysSampled_ShouldSample_ShouldNotOverrideAServerThatSamplesNothing() =>
        Decide(Sampler("parentbased_always_off"), remote: true, sampled: true)
            .ShouldBe(SamplingDecision.Drop);

    [Theory]
    [InlineData(true, SamplingDecision.RecordAndSample)]
    [InlineData(false, SamplingDecision.Drop)]
    public void whenParentIsLocal_ShouldSample_ShouldFollowIt(
        bool sampled,
        SamplingDecision expected
    ) => Decide(Sampler(), remote: false, sampled).ShouldBe(expected);
}
