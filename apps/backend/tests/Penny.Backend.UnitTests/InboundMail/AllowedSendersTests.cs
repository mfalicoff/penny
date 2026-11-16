using Penny.Backend.Application.InboundMail;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.InboundMail;

// The optional sender allowlist (MAZ-184): addresses or domains, normalized.
public sealed class AllowedSendersTests
{
    [Fact]
    public void whenValidSendersGiven_Normalize_ShouldLowercaseDeduplicateAndSort() =>
        AllowedSenders
            .Normalize([
                " Billing@Shop.Example ",
                "@shop.example",
                "shop.example",
                "me@mail.example",
            ])
            .ShouldBe(["billing@shop.example", "me@mail.example", "shop.example"]);

    [Theory]
    [InlineData("")]
    [InlineData("not an address")]
    [InlineData("@")]
    [InlineData("a@")]
    [InlineData("a@b")]
    [InlineData("shop")]
    [InlineData("a@b@shop.example")]
    [InlineData("<script>@shop.example")]
    [InlineData("shop.example\nbcc@evil.example")]
    [InlineData("-shop.example")]
    public void whenSenderInvalid_Normalize_ShouldRefuseTheWholeList(string sender) =>
        AllowedSenders.Normalize(["ok@shop.example", sender]).ShouldBeNull();

    [Fact]
    public void whenTooManySenders_Normalize_ShouldRefuse()
    {
        AllowedSenders
            .Normalize(Enumerable.Range(0, 50).Select(index => $"s{index}@shop.example"))
            .ShouldNotBeNull();
        AllowedSenders
            .Normalize(Enumerable.Range(0, 51).Select(index => $"s{index}@shop.example"))
            .ShouldBeNull();
    }

    [Theory]
    [InlineData("billing@shop.example", true)]
    [InlineData("BILLING@SHOP.EXAMPLE", true)]
    [InlineData("other@shop.example", false)]
    [InlineData("anyone@mail.example", true)]
    [InlineData("anyone@sub.mail.example", false)]
    [InlineData("mail.example", false)]
    public void whenSenderChecked_Allows_ShouldMatchAddressOrDomain(string from, bool allowed) =>
        AllowedSenders.Allows(["billing@shop.example", "mail.example"], from).ShouldBe(allowed);
}
