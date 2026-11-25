using Microsoft.Extensions.Configuration;
using Penny.Backend.Api.Configuration;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Configuration;

public sealed class ClientTelemetryOptionsTests
{
    private static ClientTelemetryOptions Read(params (string Key, string Value)[] settings) =>
        ClientTelemetryOptions.Read(
            new ConfigurationBuilder()
                .AddInMemoryCollection(
                    settings.Select(setting => new KeyValuePair<string, string?>(
                        setting.Key,
                        setting.Value
                    ))
                )
                .Build()
        );

    [Fact]
    public void whenNothingConfigured_Read_ShouldLeaveEveryClientOff()
    {
        var options = Read();
        options.WebEnabled.ShouldBeFalse();
        options.NativeEnabled.ShouldBeFalse();
        options.SessionReplay.ShouldBeFalse();
        options.RateLimitPermits.ShouldBe(120);
        options.MaxPayloadBytes.ShouldBe(1024 * 1024);
    }

    [Fact]
    public void whenCollectorsConfigured_Read_ShouldTurnOnWebNativeAndReplay()
    {
        var options = Read(
            (
                "ClientTelemetry:FaroUrl",
                "https://faro-collector-prod-eu-west-0.grafana.net/collect/abc123"
            ),
            ("ClientTelemetry:OtlpEndpoint", "http://alloy:4319"),
            ("ClientTelemetry:OtlpHeaders", "Authorization=Basic%20abc,X-Scope-OrgID=penny"),
            ("ClientTelemetry:SessionReplay", "true")
        );
        options.WebEnabled.ShouldBeTrue();
        options.NativeEnabled.ShouldBeTrue();
        options.SessionReplay.ShouldBeTrue();
        options.OtlpHeaders["authorization"].ShouldBe("Basic abc");
        options.OtlpHeaders["X-Scope-OrgID"].ShouldBe("penny");
    }

    [Theory]
    [InlineData("ClientTelemetry:FaroUrl", "ftp://alloy/collect", "ClientTelemetry__FaroUrl")]
    [InlineData(
        "ClientTelemetry:FaroUrl",
        "https://user:secret@alloy/collect",
        "ClientTelemetry__FaroUrl"
    )]
    [InlineData(
        "ClientTelemetry:OtlpEndpoint",
        "http://alloy:4319?key=secret",
        "ClientTelemetry__OtlpEndpoint"
    )]
    [InlineData("ClientTelemetry:SessionReplay", "yes", "ClientTelemetry__SessionReplay")]
    [InlineData("ClientTelemetry:SessionReplay", "true", "ClientTelemetry__FaroUrl")]
    [InlineData(
        "ClientTelemetry:OtlpHeaders",
        "Authorization=Basic%20abc",
        "ClientTelemetry__OtlpEndpoint"
    )]
    public void whenSettingIsInvalid_Read_ShouldNameTheSettingWithoutItsValue(
        string key,
        string value,
        string named
    )
    {
        var error = Should.Throw<InvalidOperationException>(() => Read((key, value)));
        error.Message.ShouldContain(named);
        error.Message.ShouldNotContain("secret");
    }
}
