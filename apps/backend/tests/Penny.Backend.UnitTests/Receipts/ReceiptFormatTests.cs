using System.Text;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Api.Receipts;
using Penny.Backend.Application.Receipts;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Receipts;

// Receipt format rules, the upload name header and the download header (MAZ-60, MAZ-131).
public sealed class ReceiptFormatTests
{
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

    // RFC 8187: only RFC 3986 unreserved characters stay literal.
    [Theory]
    [InlineData("Receipt.pdf", "Receipt.pdf")]
    [InlineData("a b+c&d=e/f?g#h", "a%20b%2Bc%26d%3De%2Ff%3Fg%23h")]
    [InlineData("!*'()~-_.", "%21%2A%27%28%29~-_.")]
    [InlineData("Café 東京", "Caf%C3%A9%20%E6%9D%B1%E4%BA%AC")]
    [InlineData("\"quoted\";x", "%22quoted%22%3Bx")]
    [InlineData("\r\n", "%0D%0A")]
    public void whenNameEncoded_Inline_ShouldPercentEncodeAllButUnreserved(
        string name,
        string encoded
    ) => ReceiptDisposition.Inline(name).ShouldBe("inline; filename*=UTF-8''" + encoded);

    // The upload's name: a `filename*` parameter, decoded strictly as UTF-8.
    [Theory]
    [InlineData("attachment; filename*=UTF-8''Receipt.pdf", "Receipt.pdf")]
    [InlineData("attachment;filename*=utf-8''Caf%C3%A9%20%E6%9D%B1.pdf", "Café 東.pdf")]
    [InlineData("inline; FILENAME*=UTF-8''a%2Bb", "a+b")]
    // encodeURIComponent output: ' ( ) * ! stay literal.
    [InlineData("attachment; filename*=UTF-8''(1)!*'.pdf", "(1)!*'.pdf")]
    [InlineData("attachment; filename=plain.pdf; filename*=UTF-8''star.pdf", "star.pdf")]
    [InlineData("attachment; filename*=UTF-8''%00.pdf", "\0.pdf")]
    [InlineData("attachment; filename*=UTF-8''", "")]
    [InlineData("attachment; filename=plain.pdf", null)]
    [InlineData("attachment", null)]
    [InlineData("attachment; filename*=ISO-8859-1''a.pdf", null)]
    [InlineData("attachment; filename*=UTF-8''a b.pdf", null)]
    [InlineData("attachment; filename*=UTF-8''%C3", null)]
    [InlineData("attachment; filename*=UTF-8''%ED%A0%80", null)]
    [InlineData("attachment; filename*=UTF-8''%G1", null)]
    [InlineData("attachment; filename*=UTF-8''a%2", null)]
    [InlineData("attachment; filename*=UTF-8''a; filename*=UTF-8''b", null)]
    [InlineData("attachment; broken", null)]
    public void whenDispositionRead_FileName_ShouldDecodeFilenameStar(
        string disposition,
        string? name
    ) => ReceiptUploadReader.FileName(disposition).ShouldBe(name);

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
