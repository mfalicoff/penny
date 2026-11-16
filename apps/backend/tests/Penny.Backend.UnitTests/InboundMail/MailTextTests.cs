using Penny.Backend.Persistence.InboundMail;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.InboundMail;

// Display text from mail headers (MAZ-184): no control, bidi or zero-width characters.
public sealed class MailTextTests
{
    [Theory]
    [InlineData("Order\r\nBcc: x@evil.example", "Order Bcc: x@evil.example")]
    [InlineData("Invoice \u202Efdp.exe", "Invoice fdp.exe")]
    [InlineData("A\u200B\u200Db\u2066c\u2069", "Abc")]
    [InlineData("  Receipt\t\t#12  ", "Receipt #12")]
    [InlineData("Caf\u00E9 \U0001F600", "Caf\u00E9 \U0001F600")]
    [InlineData("\0\u0007", "")]
    public void whenTextHasControlOrBidiCharacters_Clean_ShouldRemoveThem(
        string input,
        string expected
    ) => MailText.Clean(input).ShouldBe(expected);

    [Theory]
    [InlineData("../../etc/passwd", "_.._etc_passwd")]
    [InlineData("C:\\invoices\\march.pdf", "C__invoices_march.pdf")]
    [InlineData("invoice\u202Efdp.exe", "invoicefdp.exe")]
    [InlineData("", "attachment.pdf")]
    [InlineData("...", "attachment.pdf")]
    public void whenFileNameIsHostile_FileName_ShouldMakeItDisplayOnly(
        string input,
        string expected
    ) => MailText.FileName(input, ".pdf").ShouldBe(expected);

    [Fact]
    public void whenFileNameTooLong_FileName_ShouldKeepTheExtensionWithin255() =>
        MailText
            .FileName(new string('a', 400) + ".pdf", ".pdf")
            .ShouldSatisfyAllConditions(
                name => name.Length.ShouldBe(255),
                name => name.ShouldEndWith(".pdf")
            );
}
