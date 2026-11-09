using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Penny.Backend.Api.Push;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Push;

public sealed class ApnsProviderTokenTests
{
    [Fact]
    public void whenMinted_Current_ShouldBeEs256JwtSignedByTheKey()
    {
        var credentials = PushSamples.Credentials(out var publicKey);
        var jwt = new ApnsProviderToken(credentials, new MutableClock(PushSamples.Now)).Current();

        var parts = jwt.Split('.');
        parts.Length.ShouldBe(3);
        using var header = JsonDocument.Parse(Decode(parts[0]));
        header.RootElement.GetProperty("alg").GetString().ShouldBe("ES256");
        header.RootElement.GetProperty("kid").GetString().ShouldBe("KEY1234567");
        using var claims = JsonDocument.Parse(Decode(parts[1]));
        claims.RootElement.GetProperty("iss").GetString().ShouldBe("TEAM123456");
        claims
            .RootElement.GetProperty("iat")
            .GetInt64()
            .ShouldBe(PushSamples.Now.ToUnixTimeSeconds());
        publicKey
            .VerifyData(
                Encoding.ASCII.GetBytes($"{parts[0]}.{parts[1]}"),
                Decode(parts[2]),
                HashAlgorithmName.SHA256,
                DSASignatureFormat.IeeeP1363FixedFieldConcatenation
            )
            .ShouldBeTrue();
    }

    [Fact]
    public void whenTimePasses_Current_ShouldReuseFor40MinutesThenRefresh()
    {
        var clock = new MutableClock(PushSamples.Now);
        var tokens = new ApnsProviderToken(PushSamples.Credentials(out _), clock);
        var first = tokens.Current();

        clock.Advance(TimeSpan.FromMinutes(39));
        tokens.Current().ShouldBe(first);
        clock.Advance(TimeSpan.FromMinutes(1));
        tokens.Current().ShouldNotBe(first);
    }

    [Fact]
    public void whenCredentialsPartial_Read_ShouldRefuseStartupWithoutEchoingSecrets()
    {
        var configuration = new Microsoft.Extensions.Configuration.ConfigurationBuilder()
            .AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["Push:Apns:TeamId"] = "TEAM123456",
                    ["Push:Apns:KeyId"] = "KEY1234567",
                    ["Push:Apns:Topic"] = "org.example.penny",
                    ["Push:Apns:PrivateKey"] =
                        "-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----",
                }
            )
            .Build();

        var error = Should.Throw<InvalidOperationException>(() =>
            ApnsCredentials.Read(configuration)
        );
        error.Message.ShouldNotContain("not-a-key");
        ApnsCredentials
            .Read(new Microsoft.Extensions.Configuration.ConfigurationBuilder().Build())
            .ShouldBeNull();
        Should.Throw<InvalidOperationException>(() =>
            ApnsCredentials.Read(
                new Microsoft.Extensions.Configuration.ConfigurationBuilder()
                    .AddInMemoryCollection(
                        new Dictionary<string, string?> { ["Push:Apns:TeamId"] = "TEAM123456" }
                    )
                    .Build()
            )
        );
        PushSamples.Credentials(out _).ToString().ShouldNotContain("PRIVATE");
    }

    private static byte[] Decode(string value)
    {
        var base64 = value.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(
            base64.PadRight(base64.Length + ((4 - base64.Length % 4) % 4), '=')
        );
    }
}
