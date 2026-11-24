using System.Security.Cryptography;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Penny.Backend.Api.Authentication;
using Penny.Backend.Api.Configuration;
using Penny.Backend.UnitTests.Push;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Authentication;

public sealed class AppleClientSecretTests
{
    private static readonly DateTimeOffset Start = DateTimeOffset.FromUnixTimeSeconds(
        1_900_000_000
    );

    [Fact]
    public async Task whenSecretRequested_Current_ShouldBeAnEs256JwtForAppleSignedWithTheKey()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var clock = new MutableClock(Start);
        using var secret = new AppleClientSecret(
            new("TEAM123456", "KEY1234567", "test.penny.web", key.ExportPkcs8PrivateKeyPem()),
            clock
        );

        var token = secret.Current();

        var result = await new JsonWebTokenHandler().ValidateTokenAsync(
            token,
            new TokenValidationParameters
            {
                ValidIssuer = "TEAM123456",
                ValidAudience = "https://appleid.apple.com",
                IssuerSigningKey = new ECDsaSecurityKey(
                    ECDsa.Create(key.ExportParameters(includePrivateParameters: false))
                ),
                ValidAlgorithms = [SecurityAlgorithms.EcdsaSha256],
                ValidateLifetime = false,
            }
        );
        result.IsValid.ShouldBeTrue();
        var jwt = (JsonWebToken)result.SecurityToken;
        jwt.Alg.ShouldBe("ES256");
        jwt.Kid.ShouldBe("KEY1234567");
        jwt.Subject.ShouldBe("test.penny.web");
        jwt.IssuedAt.ShouldBe(Start.UtcDateTime);
        jwt.ValidTo.ShouldBe((Start + TimeSpan.FromDays(1)).UtcDateTime);
        secret.ToString().ShouldNotContain(token);
    }

    [Fact]
    public void whenHalfTheLifetimePasses_Current_ShouldReuseThenRenewTheSecret()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var clock = new MutableClock(Start);
        using var secret = new AppleClientSecret(
            new("TEAM123456", "KEY1234567", "test.penny.web", key.ExportPkcs8PrivateKeyPem()),
            clock
        );
        var first = secret.Current();

        clock.Advance(AppleClientSecret.Lifetime / 2 - TimeSpan.FromSeconds(1));
        secret.Current().ShouldBe(first);

        clock.Advance(TimeSpan.FromSeconds(1));
        var renewed = secret.Current();
        renewed.ShouldNotBe(first);
        new JsonWebToken(renewed).IssuedAt.ShouldBe(
            (Start + AppleClientSecret.Lifetime / 2).UtcDateTime
        );
    }
}
