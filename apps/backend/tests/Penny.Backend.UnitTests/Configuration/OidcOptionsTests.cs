using System.Security.Cryptography;
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
                    values
                        .GroupBy(pair => pair.Key)
                        .Select(group => new KeyValuePair<string, string?>(
                            group.Key,
                            group.Last().Value
                        ))
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

    private static OidcProviderOptions Single(params (string Key, string Value)[] values) =>
        Read(values)!.Providers.ShouldHaveSingleItem();

    [Fact]
    public void whenMinimalSettingsConfigured_Read_ShouldUseDefaults()
    {
        var options = Single(Valid());
        options.Id.ShouldBe("sso");
        options.Icon.ShouldBe("sso");
        options.Scope.ShouldBe("openid email profile");
        options.CallbackUri.ShouldBeNull();
        options.NativeClientIds.ShouldBeEmpty();
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
        var options = Single(
            Valid(
                ("Oidc:ClientSecret", Secret),
                (
                    "Oidc:RedirectUris",
                    " https://penny.example.test/auth/callback , http://localhost:4173/auth/callback,penny://auth/callback,"
                ),
                ("Oidc:Label", "Company login"),
                ("Oidc:AllowRegistration", "True")
            )
        );
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

    private const string Google = "Oidc:Providers:google:";
    private const string Apple = "Oidc:Providers:apple:";

    private static (string, string)[] GoogleSettings(params (string, string)[] extra) =>
        [
            (Google + "Issuer", "https://accounts.google.com"),
            (Google + "ClientId", "google-client"),
            (Google + "ClientSecret", Secret),
            (Google + "RedirectUris", "https://penny.example.test/auth/callback"),
            .. extra,
        ];

    private static (string, string)[] AppleSettings(params (string, string)[] extra) =>
        [
            (Apple + "Issuer", "https://appleid.apple.com"),
            (Apple + "ClientId", "test.penny.web"),
            (Apple + "RedirectUris", "https://penny.example.test/auth/callback"),
            (Apple + "CallbackUri", "https://penny.example.test/api/auth/oidc/callback/apple"),
            (Apple + "TeamId", "TEAM123456"),
            (Apple + "KeyId", "KEY1234567"),
            (Apple + "PrivateKey", ApplePem),
            .. extra,
        ];

    private static readonly string ApplePem = CreatePem();

    private static string CreatePem()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        return key.ExportPkcs8PrivateKeyPem();
    }

    [Fact]
    public void whenSeveralProvidersConfigured_Read_ShouldListEachInOrderWithProviderDefaults()
    {
        var options = Read([
            .. Valid(),
            .. GoogleSettings(),
            .. AppleSettings(
                (Apple + "Order", "-1"),
                (Apple + "NativeClientIds", "test.penny.app")
            ),
        ])!;
        options.Providers.Select(provider => provider.Id).ShouldBe(["apple", "google", "sso"]);
        var google = options.Find("google")!;
        google.Label.ShouldBe("Google");
        google.Icon.ShouldBe("google");
        google.Scope.ShouldBe("openid email profile");
        google.ResponseMode.ShouldBeNull();
        google
            .ProviderRedirectUri("https://penny.example.test/auth/callback")
            .ShouldBe("https://penny.example.test/auth/callback");
        var apple = options.Find("apple")!;
        apple.Label.ShouldBe("Apple");
        apple.Icon.ShouldBe("apple");
        apple.Scope.ShouldBe("openid email name");
        apple.ResponseMode.ShouldBe("form_post");
        apple.ClientSecret.ShouldBeNull();
        apple.AppleClientSecret.ShouldNotBeNull().TeamId.ShouldBe("TEAM123456");
        apple.NativeClientIds.ShouldBe(["test.penny.app"]);
        apple
            .ProviderRedirectUri("penny://auth/callback")
            .ShouldBe("https://penny.example.test/api/auth/oidc/callback/apple");
        options.ToString().ShouldNotContain(Secret);
        apple.AppleClientSecret!.ToString().ShouldNotContain("BEGIN");
    }

    [Fact]
    public void whenOnlyDictionaryProvidersConfigured_Read_ShouldNotNeedSingleProviderSettings()
    {
        var options = Read(
            GoogleSettings(
                (Google + "Label", "Sign in with Google"),
                (Google + "Icon", "google-workspace"),
                (Google + "Scopes", "openid,email"),
                (Google + "AllowRegistration", "true")
            )
        )!;
        var google = options.Providers.ShouldHaveSingleItem();
        google.Label.ShouldBe("Sign in with Google");
        google.Icon.ShouldBe("google-workspace");
        google.Scope.ShouldBe("openid email");
        google.AllowRegistration.ShouldBeTrue();
    }

    [Fact]
    public void whenProviderIdUsesUpperCase_Read_ShouldUseLowerCaseId()
    {
        Read(
            ("Oidc:Providers:Google:Issuer", "https://accounts.google.com"),
            ("Oidc:Providers:Google:ClientId", "google-client"),
            ("Oidc:Providers:Google:RedirectUris", "https://penny.example.test/auth/callback")
        )!
            .Providers.ShouldHaveSingleItem()
            .Id.ShouldBe("google");
    }

    [Fact]
    public void whenApplePrivateKeyInFile_Read_ShouldLoadIt()
    {
        var path = Path.GetTempFileName();
        try
        {
            File.WriteAllText(path, ApplePem);
            var apple = Read([
                .. AppleSettings().Where(pair => pair.Item1 != Apple + "PrivateKey"),
                (Apple + "PrivateKeyFile", path),
            ])!
                .Providers.ShouldHaveSingleItem();
            apple.AppleClientSecret!.PrivateKeyPem.ShouldBe(ApplePem);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void whenApplePrivateKeyHasEscapedNewLines_Read_ShouldAcceptIt()
    {
        var apple = Read(AppleSettings((Apple + "PrivateKey", ApplePem.ReplaceLineEndings("\\n"))))!
            .Providers.ShouldHaveSingleItem();
        apple.AppleClientSecret!.PrivateKeyPem.ShouldBe(ApplePem.ReplaceLineEndings("\n"));
    }

    [Fact]
    public void whenLegacyAndDictionaryConfigureSso_Read_ShouldFail()
    {
        var error = Should.Throw<InvalidOperationException>(() =>
            Read([
                .. Valid(),
                ("Oidc:Providers:sso:Issuer", "https://identity.example.test"),
                ("Oidc:Providers:sso:ClientId", "penny"),
                ("Oidc:Providers:sso:RedirectUris", "penny://auth/callback"),
            ])
        );
        error.Message.ShouldContain("Oidc:Providers:sso");
    }

    [Theory]
    [InlineData(
        "Oidc:Providers:bad.id:Issuer",
        "https://accounts.google.com",
        "Oidc:Providers:bad.id"
    )]
    [InlineData(Google + "RedirectUris", "", Google + "RedirectUris")]
    [InlineData(Google + "Issuer", "http://accounts.google.com", Google + "Issuer")]
    [InlineData(
        Google + "CallbackUri",
        "https://penny.example.test/api/auth/oidc/callback/apple",
        Google + "CallbackUri"
    )]
    [InlineData(
        Google + "CallbackUri",
        "http://penny.example.test/api/auth/oidc/callback/google",
        Google + "CallbackUri"
    )]
    [InlineData(Google + "Scopes", "email profile", Google + "Scopes")]
    [InlineData(Google + "Icon", "Google!", Google + "Icon")]
    [InlineData(Google + "Order", "first", Google + "Order")]
    [InlineData(Google + "AllowRegistration", "1", Google + "AllowRegistration")]
    [InlineData(Google + "TeamId", "TEAM123456", Google + "TeamId")]
    public void whenProviderValueInvalid_Read_ShouldFailWithSettingNameAndNoSecret(
        string key,
        string value,
        string setting
    )
    {
        var error = Should.Throw<InvalidOperationException>(() =>
            Read([.. GoogleSettings(), (key, value), (Google + "ClientId", "google-client")])
        );
        error.Message.ShouldContain(setting);
        error.Message.ShouldNotContain(Secret);
    }

    [Theory]
    [InlineData("CallbackUri", "")]
    [InlineData("PrivateKey", "")]
    [InlineData("PrivateKey", "-----BEGIN PRIVATE KEY-----\nnot a key\n-----END PRIVATE KEY-----")]
    [InlineData("TeamId", "TEAM")]
    [InlineData("KeyId", "")]
    [InlineData("PrivateKeyFile", "/nonexistent/penny-apple-key.p8")]
    [InlineData("ClientSecret", Secret)]
    public void whenAppleSettingInvalid_Read_ShouldFailWithSettingNameAndNoKey(
        string key,
        string value
    )
    {
        var error = Should.Throw<InvalidOperationException>(() =>
            Read(AppleSettings((Apple + key, value)))
        );
        error.Message.ShouldContain(Apple);
        error.Message.ShouldNotContain("BEGIN");
        error.Message.ShouldNotContain(Secret);
    }

    [Fact]
    public void whenAppleKeyIsNotP256_Read_ShouldFail()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP384);
        Should
            .Throw<InvalidOperationException>(() =>
                Read(AppleSettings((Apple + "PrivateKey", key.ExportPkcs8PrivateKeyPem())))
            )
            .Message.ShouldContain(Apple + "PrivateKey");
    }
}
