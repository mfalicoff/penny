using Microsoft.Extensions.Configuration;
using Penny.Backend.Api.Configuration;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Configuration;

public sealed class TelemetryOptionsTests
{
    private const string Secret = "Authorization=Basic c2VjcmV0LXRlbGVtZXRyeS10b2tlbg==";

    private static TelemetryOptions Read(params (string Key, string Value)[] values) =>
        TelemetryOptions.Read(
            new ConfigurationBuilder()
                .AddInMemoryCollection(
                    values.Select(pair => new KeyValuePair<string, string?>(pair.Key, pair.Value))
                )
                .Build()
        );

    [Fact]
    public void whenNoEndpointConfigured_Read_ShouldLeaveTelemetryOff()
    {
        var options = Read(("OTEL_SERVICE_NAME", "ignored"), ("OTEL_TRACES_SAMPLER", "bogus"));
        options.Enabled.ShouldBeFalse();
    }

    [Fact]
    public void whenEndpointConfigured_Read_ShouldEnableWithDefaultServiceName()
    {
        var options = Read(
            (TelemetryOptions.Endpoint, "http://alloy:4317"),
            ("OTEL_EXPORTER_OTLP_PROTOCOL", "grpc"),
            ("OTEL_EXPORTER_OTLP_HEADERS", Secret),
            ("OTEL_TRACES_SAMPLER", "parentbased_traceidratio"),
            ("OTEL_TRACES_SAMPLER_ARG", "0.25"),
            ("OTEL_RESOURCE_ATTRIBUTES", "deployment.environment.name=home")
        );
        options.ShouldBe(new TelemetryOptions(true, TelemetryOptions.DefaultServiceName));
    }

    [Fact]
    public void whenSdkDisabled_Read_ShouldLeaveTelemetryOffDespiteEndpoint()
    {
        var options = Read(
            (TelemetryOptions.Endpoint, "http://alloy:4317"),
            ("OTEL_SDK_DISABLED", "true")
        );
        options.Enabled.ShouldBeFalse();
    }

    [Theory]
    [InlineData(null, "service.name=from-resource", "from-resource")]
    [InlineData("from-variable", "service.name=from-resource", "from-variable")]
    [InlineData(null, "host.name=box", TelemetryOptions.DefaultServiceName)]
    public void whenServiceNameGiven_Read_ShouldPreferVariableThenResourceAttribute(
        string? name,
        string resource,
        string expected
    )
    {
        var values = new List<(string, string)>
        {
            (TelemetryOptions.Endpoint, "https://otel.example.test"),
            ("OTEL_RESOURCE_ATTRIBUTES", resource),
        };
        if (name is not null)
            values.Add(("OTEL_SERVICE_NAME", name));
        Read([.. values]).ServiceName.ShouldBe(expected);
    }

    [Theory]
    [InlineData("OTEL_EXPORTER_OTLP_ENDPOINT", "alloy:4317")]
    [InlineData("OTEL_EXPORTER_OTLP_ENDPOINT", "ftp://alloy")]
    [InlineData("OTEL_EXPORTER_OTLP_ENDPOINT", "https://user:secret-password@alloy")]
    [InlineData("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "https://alloy/v1/traces?token=secret")]
    [InlineData("OTEL_EXPORTER_OTLP_PROTOCOL", "http/json")]
    [InlineData("OTEL_EXPORTER_OTLP_LOGS_PROTOCOL", "udp")]
    [InlineData("OTEL_EXPORTER_OTLP_HEADERS", "secret-token-without-key")]
    [InlineData("OTEL_EXPORTER_OTLP_METRICS_HEADERS", "=secret-token")]
    [InlineData("OTEL_EXPORTER_OTLP_TIMEOUT", "-5")]
    [InlineData("OTEL_TRACES_SAMPLER", "sometimes")]
    [InlineData("OTEL_TRACES_SAMPLER_ARG", "1.5")]
    [InlineData("OTEL_METRIC_EXPORT_INTERVAL", "soon")]
    [InlineData("OTEL_RESOURCE_ATTRIBUTES", "no-pairs-here")]
    [InlineData("OTEL_SERVICE_NAME", " ")]
    [InlineData("OTEL_SDK_DISABLED", "maybe")]
    public void whenSettingInvalid_Read_ShouldNameSettingWithoutEchoingValue(
        string key,
        string value
    )
    {
        var values = new List<(string, string)> { (key, value) };
        if (key != TelemetryOptions.Endpoint)
            values.Add((TelemetryOptions.Endpoint, "http://alloy:4317"));
        if (key == "OTEL_TRACES_SAMPLER_ARG")
            values.Add(("OTEL_TRACES_SAMPLER", "traceidratio"));
        var error = Should.Throw<InvalidOperationException>(() => Read([.. values]));
        error.Message.ShouldStartWith(key + " ");
        if (value.Trim().Length > 0)
            error.Message.ShouldNotContain(value);
        error.Message.ShouldNotContain("secret");
    }

    [Fact]
    public void whenSamplerArgumentWithoutRatioSampler_Read_ShouldFail() =>
        Should
            .Throw<InvalidOperationException>(() =>
                Read(
                    (TelemetryOptions.Endpoint, "http://alloy:4317"),
                    ("OTEL_TRACES_SAMPLER_ARG", "0.5")
                )
            )
            .Message.ShouldStartWith("OTEL_TRACES_SAMPLER_ARG ");

    [Fact]
    public void whenSignalEndpointWithoutBaseEndpoint_Read_ShouldFail() =>
        Should
            .Throw<InvalidOperationException>(() =>
                Read(("OTEL_EXPORTER_OTLP_LOGS_ENDPOINT", "http://loki:4318/v1/logs"))
            )
            .Message.ShouldStartWith("OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ");
}
