using Microsoft.AspNetCore.Identity;
using Penny.Backend.Api.Authentication;
using Penny.Backend.Application.Abstractions.Security;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Authentication;

public sealed class IdentityPasswordHasherTests
{
    private const string Password = "a secure test password";

    // A hash written by the legacy Node scrypt implementation (synthetic credentials).
    private const string LegacyScryptHash =
        "6d4347584d1b837f80c695dc3f951ee36ebae6ff975402cba940f8a1c9b2574b5ba24380bd1a1de4d757032e9d6ed1f00131af295fd99083028916b841e48058";

    [Fact]
    public void whenPasswordHashed_Verify_ShouldAcceptOnlyTheSamePassword()
    {
        var hasher = new IdentityPasswordHasher();
        var hash = hasher.Hash(Password);
        hash.ShouldStartWith("AQAAAAI"); // Identity v3, PBKDF2-HMAC-SHA512
        hasher.Hash(Password).ShouldNotBe(hash); // random embedded salt
        hasher.Verify(hash, Password).ShouldBe(PasswordCheck.Success);
        hasher.Verify(hash, Password + " ").ShouldBe(PasswordCheck.Failed);
        hasher.Verify(hash, Password.ToUpperInvariant()).ShouldBe(PasswordCheck.Failed);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(LegacyScryptHash)]
    [InlineData("not base64!")]
    [InlineData("AAAA")]
    public void whenStoredHashUnusable_Verify_ShouldFail(string? stored) =>
        new IdentityPasswordHasher().Verify(stored, Password).ShouldBe(PasswordCheck.Failed);

    [Fact]
    public void whenIterationCountRaised_Verify_ShouldRequestRehash()
    {
        var weaker = new IdentityPasswordHasher(
            new PasswordHasherOptions { IterationCount = 1000 }
        );
        var hash = weaker.Hash(Password);
        new IdentityPasswordHasher()
            .Verify(hash, Password)
            .ShouldBe(PasswordCheck.SuccessRehashNeeded);
    }
}
