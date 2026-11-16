using Penny.Backend.Application.InboundMail;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.InboundMail;

// Receipt address local parts (MAZ-184): about 100 bits of lowercase base32 after `r-`.
public sealed class ReceiptMailAddressesTests
{
    [Fact]
    public void whenGenerated_NewLocalPart_ShouldBeUniqueLowercaseBase32()
    {
        var parts = Enumerable
            .Range(0, 1000)
            .Select(_ => ReceiptMailAddresses.NewLocalPart())
            .ToList();
        parts.ShouldAllBe(part => ReceiptMailAddresses.IsLocalPart(part));
        parts.Distinct().Count().ShouldBe(parts.Count);
        // Every alphabet character shows up, so the generator is not biased to a subset.
        string.Concat(parts.Select(part => part[2..])).Distinct().Count().ShouldBe(32);
    }

    [Theory]
    [InlineData("r-abcdefghijklmnopqrst", "r-abcdefghijklmnopqrst")]
    [InlineData("R-ABCDEFGHIJKLMNOPQRST@Receipts.Example.Test", "r-abcdefghijklmnopqrst")]
    [InlineData("r-abcdefghijklmnopqrst+amazon@receipts.example.test", "r-abcdefghijklmnopqrst")]
    [InlineData("r-abcdefghijklmnopqrs@receipts.example.test", null)]
    [InlineData("r-abcdefghijklmnopqrstu@receipts.example.test", null)]
    [InlineData("r-abcdefghijklmnopqrs1@receipts.example.test", null)]
    [InlineData("x-abcdefghijklmnopqrst@receipts.example.test", null)]
    [InlineData("postmaster@receipts.example.test", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void whenRecipientGiven_Normalize_ShouldReturnCanonicalLocalPart(
        string? recipient,
        string? expected
    ) => ReceiptMailAddresses.Normalize(recipient).ShouldBe(expected);

    [Fact]
    public void whenHashed_Hash_ShouldBeLowercaseSha256Hex() =>
        ReceiptMailAddresses
            .Hash("r-abcdefghijklmnopqrst")
            .ShouldBe("360101bf5f8fae97694edd98804306edb00193c5ac915068ff9c928cf06dc469");
}
