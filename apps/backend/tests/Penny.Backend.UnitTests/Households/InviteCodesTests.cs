using Penny.Backend.Application.Households;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Households;

public sealed class InviteCodesTests
{
    [Fact]
    public void whenInviteIssued_InviteCodes_ShouldBeTenUpperHexAndHashWithSha256()
    {
        var codes = Enumerable.Range(0, 32).Select(_ => InviteCodes.Create()).ToList();
        codes.ShouldAllBe(code =>
            System.Text.RegularExpressions.Regex.IsMatch(code, "^[0-9A-F]{10}$")
        );
        codes.Distinct().Count().ShouldBeGreaterThan(1);
        // SHA-256 of "ABCDEF0123" as lower-case hex.
        InviteCodes
            .Hash("ABCDEF0123")
            .ShouldBe("3419d586bcb059c424e7d67eca7ecca2b1e94bc920e97d8d86551a0c661579df");
        InviteCodes.Hash("ABCDEF0123").ShouldNotBe(InviteCodes.Hash("abcdef0123"));
        InviteCodes.Lifetime.ShouldBe(TimeSpan.FromMinutes(10));
    }
}
