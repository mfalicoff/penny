using System.Text;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Application.Receipts;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Receipts;

// Receipt upload format rules and the download header (MAZ-60).
public sealed class ReceiptFormatTests
{
    [Theory]
    [InlineData("QQ==", true)]
    [InlineData("QQ", true)]
    [InlineData("Q", true)]
    [InlineData("ab+/09", true)]
    [InlineData("", false)]
    [InlineData("=", false)]
    [InlineData("==", false)]
    [InlineData("QQ===", false)]
    [InlineData("Q=Q", false)]
    [InlineData("Q Q", false)]
    [InlineData("QQ\n", false)]
    [InlineData("a-b_", false)]
    [InlineData("QUJDé", false)]
    public void whenTextChecked_IsBase64Text_ShouldMatchTheUploadPattern(string text, bool valid) =>
        ReceiptFormat.IsBase64Text(text).ShouldBe(valid);

    // Expected values follow the lenient decoding: optional padding, a dangling
    // character ignored.
    [Theory]
    [InlineData("QUJD", "414243")]
    [InlineData("QUI=", "4142")]
    [InlineData("QUI", "4142")]
    [InlineData("QQ==", "41")]
    [InlineData("QQ", "41")]
    [InlineData("QR", "41")]
    [InlineData("Q", "")]
    [InlineData("QUJDR", "414243")]
    [InlineData("QUJD=", "414243")]
    public void whenTextDecoded_Decode_ShouldMatchNodeBuffer(string text, string hex) =>
        Convert.ToHexString(ReceiptFormat.Decode(text)).ShouldBe(hex);

    [Theory]
    [InlineData("application/pdf", "255044462D", true)]
    [InlineData("application/pdf", "25504446", false)]
    [InlineData("image/jpeg", "FFD8FF", true)]
    [InlineData("image/jpeg", "FFD8FE", false)]
    [InlineData("image/png", "89504E470D0A1A0A", true)]
    [InlineData("image/png", "89504E470D0A1A", false)]
    [InlineData("image/gif", "474946383761", true)]
    [InlineData("image/gif", "474946383961", true)]
    [InlineData("image/gif", "474946383861", false)]
    [InlineData("image/webp", "524946460000000057454250", true)]
    [InlineData("image/webp", "5249464600000000574542", false)]
    [InlineData("image/webp", "524946460000000057454251", false)]
    [InlineData("image/heic", "0000001866747970", true)]
    [InlineData("image/heif", "0000001866747970", true)]
    [InlineData("image/heic", "00000018667479", false)]
    [InlineData("image/heif", "0000001866747971", false)]
    public void whenSignatureChecked_IsAcceptable_ShouldMatchTheDeclaredType(
        string mime,
        string hex,
        bool accepted
    ) => ReceiptFormat.IsAcceptable(mime, Convert.FromHexString(hex)).ShouldBe(accepted);

    [Fact]
    public void whenSizeChecked_IsAcceptable_ShouldAllowOneByteToTenMegabytes()
    {
        ReceiptFormat.IsAcceptable("application/pdf", []).ShouldBeFalse();
        var largest = new byte[ReceiptFormat.MaxBytes];
        "%PDF-"u8.CopyTo(largest);
        ReceiptFormat.IsAcceptable("application/pdf", largest).ShouldBeTrue();
        var larger = new byte[ReceiptFormat.MaxBytes + 1];
        "%PDF-"u8.CopyTo(larger);
        ReceiptFormat.IsAcceptable("application/pdf", larger).ShouldBeFalse();
    }

    // Expected values are JavaScript encodeURIComponent.
    [Theory]
    [InlineData("Receipt.pdf", "Receipt.pdf")]
    [InlineData("a b+c&d=e/f?g#h", "a%20b%2Bc%26d%3De%2Ff%3Fg%23h")]
    [InlineData("!*'()~-_.", "!*'()~-_.")]
    [InlineData("Café 東京", "Caf%C3%A9%20%E6%9D%B1%E4%BA%AC")]
    [InlineData("\"quoted\";x", "%22quoted%22%3Bx")]
    [InlineData("\r\n", "%0D%0A")]
    public void whenNameEncoded_EncodeUriComponent_ShouldMatchJavaScript(
        string name,
        string encoded
    ) => ReceiptDisposition.EncodeUriComponent(name).ShouldBe(encoded);

    [Fact]
    public void whenNameHasAstralCharacters_Inline_ShouldEncodeUtf8()
    {
        var name = "👩‍👩‍👧 " + Encoding.UTF8.GetString([0xF0, 0x9F, 0x8D, 0x95]) + ".pdf";
        ReceiptDisposition
            .Inline(name)
            .ShouldBe(
                "inline; filename*=UTF-8''%F0%9F%91%A9%E2%80%8D%F0%9F%91%A9%E2%80%8D%F0%9F%91%A7%20%F0%9F%8D%95.pdf"
            );
    }
}
