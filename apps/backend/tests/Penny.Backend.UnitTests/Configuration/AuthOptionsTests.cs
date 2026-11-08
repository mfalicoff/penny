using Microsoft.Extensions.Configuration;
using Penny.Backend.Api.Configuration;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Configuration;

public sealed class AuthOptionsTests
{
    private static AuthOptions Read(params (string Key, string Value)[] values) =>
        AuthOptions.Read(
            new ConfigurationBuilder()
                .AddInMemoryCollection(
                    values.Select(pair => new KeyValuePair<string, string?>(pair.Key, pair.Value))
                )
                .Build()
        );

    [Fact]
    public void whenNothingConfigured_Read_ShouldUseLegacyDefaults()
    {
        var options = Read();
        options.AllowRegistration.ShouldBeTrue();
        options.SecureCookies.ShouldBeFalse();
        options.AllowedOrigins.ShouldBe(["http://localhost:8081", "http://localhost:3001"]);
        options.TrustedProxies.ShouldBeEmpty();
        options.RateLimitPermits.ShouldBe(40);
    }

    [Fact]
    public void whenValuesConfigured_Read_ShouldParseListsAndFlags()
    {
        var options = Read(
            ("Auth:AllowRegistration", "false"),
            ("Auth:SecureCookies", "True"),
            ("Auth:AllowedOrigins", " https://penny.example.com , http://192.168.1.50:3001,"),
            ("Auth:TrustedProxies", "10.0.0.0/8, ::1")
        );
        options.AllowRegistration.ShouldBeFalse();
        options.SecureCookies.ShouldBeTrue();
        options.AllowedOrigins.ShouldBe(["https://penny.example.com", "http://192.168.1.50:3001"]);
        options
            .TrustedProxies.Select(network => network.ToString())
            .ShouldBe(["10.0.0.0/8", "::1/128"]);
    }

    [Theory]
    [InlineData("Auth:AllowRegistration", "yes")]
    [InlineData("Auth:SecureCookies", "1")]
    [InlineData("Auth:AllowedOrigins", "https://penny.example.com/")]
    [InlineData("Auth:AllowedOrigins", "https://penny.example.com:443")]
    [InlineData("Auth:AllowedOrigins", "https://Penny.example.com")]
    [InlineData("Auth:AllowedOrigins", "ftp://penny.example.com")]
    [InlineData("Auth:AllowedOrigins", "*")]
    [InlineData("Auth:TrustedProxies", "proxy.internal")]
    [InlineData("Auth:RateLimitPermits", "0")]
    public void whenValueInvalid_Read_ShouldFailWithSettingName(string key, string value)
    {
        var error = Should.Throw<InvalidOperationException>(() => Read((key, value)));
        error.Message.ShouldContain(key);
    }
}
