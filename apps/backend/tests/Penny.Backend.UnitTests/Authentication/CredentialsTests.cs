using Penny.Backend.Application.Authentication;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Authentication;

public sealed class CredentialsTests
{
    private const string Password = "a secure test password";

    // Expected values come from the legacy zod 4 schema in server/validation/auth.ts.
    [Theory]
    [InlineData(" PERSON@EXAMPLE.TEST ", "person@example.test")]
    [InlineData("\uFEFF\u3000a@b.co\u2028", "a@b.co")]
    [InlineData("\u212Aa@b.co", "ka@b.co")]
    [InlineData("first.last+tag@sub.example.com", "first.last+tag@sub.example.com")]
    [InlineData("o'neil@example.test", "o'neil@example.test")]
    [InlineData("a@b.co\n", "a@b.co")]
    public void whenEmailAcceptedByLegacySchema_Normalize_ShouldTrimAndLowercase(
        string email,
        string expected
    ) => Credentials.Normalize(email, Password)!.Email.ShouldBe(expected);

    [Theory]
    [InlineData("\u0085a@b.co")]
    [InlineData("a@b.c")]
    [InlineData(".a@b.co")]
    [InlineData("a..b@b.co")]
    [InlineData("a.@b.co")]
    [InlineData("\u0130@b.co")]
    [InlineData("\u00E9@b.co")]
    [InlineData("a@-b.co")]
    [InlineData("")]
    public void whenEmailRejectedByLegacySchema_Normalize_ShouldReturnNull(string email) =>
        Credentials.Normalize(email, Password).ShouldBeNull();

    [Fact]
    public void whenLengthsAtBoundaries_Normalize_ShouldApplyUtf16Limits()
    {
        var local = new string('a', 64);
        var longest = local + "@" + new string('b', 254 - 64 - 1 - 3) + ".co";
        longest.Length.ShouldBe(254);
        Credentials.Normalize(longest, Password).ShouldNotBeNull();
        Credentials.Normalize("a" + longest, Password).ShouldBeNull();
        Credentials.Normalize("a@b.co", new string('x', 9)).ShouldBeNull();
        Credentials.Normalize("a@b.co", new string('x', 10)).ShouldNotBeNull();
        Credentials.Normalize("a@b.co", new string('x', 256)).ShouldNotBeNull();
        Credentials.Normalize("a@b.co", new string('x', 257)).ShouldBeNull();
        // Passwords are not trimmed and count UTF-16 code units, like JavaScript.
        Credentials
            .Normalize("a@b.co", "\uD83D\uDC69\u200D\uD83D\uDC69\u200D\uD83D\uDC67\uD83D\uDC69")
            .ShouldNotBeNull();
        Credentials.Normalize("a@b.co", null).ShouldBeNull();
        Credentials.Normalize(null, Password).ShouldBeNull();
        Credentials.Normalize("a@b.co", Password)!.ToString().ShouldNotContain(Password);
    }
}
