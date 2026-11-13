using Microsoft.Extensions.Configuration;
using Penny.Backend.Api.Configuration;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Configuration;

public sealed class OidcOptionsTests
{
    private const string Secret = "synthetic-secret-value";

    private static OidcOptions? Read(params (string Key, string Value)[] values) =>
        OidcOptions.Read(
            new ConfigurationBuilder()
                .AddInMemoryCollection(
                    values.Select(pair => new KeyValuePair<string, string?>(pair.Key, pair.Value))
                )
                .Build()
        );

    private static (string, string)[] Valid(params (string Key, string Value)[] overrides) =>
        [
            .. new Dictionary<string, string>
            {
                ["Oidc:Issuer"] = "https://identity.example.test/realms/penny",
                ["Oidc:ClientId"] = "penny",
                ["Oidc:RedirectUris"] = "penny://auth/callback",
            }
                .Concat(overrides.Select(pair => KeyValuePair.Create(pair.Key, pair.Value)))
                .GroupBy(pair => pair.Key)
                .Select(group => (group.Key, group.Last().Value)),
        ];

    [Fact]
    public void whenNothingOrEmptyConfigured_Read_ShouldDisableOidc()
    {
        Read().ShouldBeNull();
        Read(("Oidc:Issuer", ""), ("Oidc:ClientId", ""), ("Oidc:RedirectUris", "x")).ShouldBeNull();
    }

    [Fact]
    public void whenMinimalSettingsConfigured_Read_ShouldUseDefaults()
    {
        var options = Read(Valid())!;
        options.Issuer.ShouldBe("https://identity.example.test/realms/penny");
        options.ClientId.ShouldBe("penny");
        options.ClientSecret.ShouldBeNull();
        options.RedirectUris.ShouldBe(["penny://auth/callback"]);
        options.Label.ShouldBe("Single sign-on");
        options.AllowRegistration.ShouldBeFalse();
    }

    [Fact]
    public void whenAllSettingsConfigured_Read_ShouldParseListAndKeepSecretOutOfText()
    {
        var options = Read(
            Valid(
                ("Oidc:ClientSecret", Secret),
                (
                    "Oidc:RedirectUris",
                    " https://penny.example.test/auth/callback , http://localhost:4173/auth/callback,penny://auth/callback,"
                ),
                ("Oidc:Label", "Company login"),
                ("Oidc:AllowRegistration", "True")
            )
        )!;
        options.ClientSecret.ShouldBe(Secret);
        options.RedirectUris.ShouldBe([
            "https://penny.example.test/auth/callback",
            "http://localhost:4173/auth/callback",
            "penny://auth/callback",
        ]);
        options.Label.ShouldBe("Company login");
        options.AllowRegistration.ShouldBeTrue();
        options.ToString().ShouldNotContain(Secret);
    }

    [Theory]
    [InlineData("Oidc:Issuer", "")]
    [InlineData("Oidc:ClientId", "")]
    [InlineData("Oidc:RedirectUris", "")]
    [InlineData("Oidc:RedirectUris", " , ")]
    [InlineData("Oidc:Issuer", "http://identity.example.test")]
    [InlineData("Oidc:Issuer", "https://identity.example.test?tenant=1")]
    [InlineData("Oidc:Issuer", "https://identity.example.test#top")]
    [InlineData("Oidc:Issuer", "https://user:pass@identity.example.test")]
    [InlineData("Oidc:Issuer", "identity.example.test")]
    [InlineData("Oidc:RedirectUris", "http://penny.example.test/auth/callback")]
    [InlineData("Oidc:RedirectUris", "https://penny.example.test/auth/callback?next=1")]
    [InlineData("Oidc:RedirectUris", "https://penny.example.test/auth/callback#x")]
    [InlineData("Oidc:RedirectUris", "penny://auth/other")]
    [InlineData("Oidc:RedirectUris", "otherapp://auth/callback")]
    [InlineData("Oidc:RedirectUris", "https://penny.example.test/cb,javascript:alert(1)")]
    [InlineData("Oidc:AllowRegistration", "yes")]
    public void whenValueInvalid_Read_ShouldFailWithSettingNameAndNoSecret(string key, string value)
    {
        var error = Should.Throw<InvalidOperationException>(() =>
            Read(Valid(("Oidc:ClientSecret", Secret), (key, value)))
        );
        error.Message.ShouldContain(key);
        error.Message.ShouldNotContain(Secret);
    }
}
