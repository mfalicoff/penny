using System.Text;
using Penny.Backend.Application.InboundMail;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.InboundMail;

// The ingress HMAC (MAZ-184). The vectors were computed independently with Node's
// crypto module; apps/email-worker/test/signature.test.ts pins the same values, so
// the Worker and the API cannot drift apart.
public sealed class InboundMailSignatureTests
{
    public static readonly byte[] Secret = Convert.FromBase64String(
        "cGVubnktdGVzdC1zZWNyZXQtMzItYnl0ZXMtbG9uZyEh"
    );
    public const string Timestamp = "1763300000";
    public const string Recipient = "r-abcdefghijklmnopqrst";
    public static readonly byte[] Body = Encoding.ASCII.GetBytes(
        "From: shop@example.test\r\nTo: r-abcdefghijklmnopqrst@receipts.example.test\r\nSubject: Receipt\r\n\r\nThanks!\r\n"
    );
    public const string MessageSignature =
        "681b1c87d3494cfbf13a35c8b767dacd26ab0e7b7fd30191eb07f5b8a86454c0";
    public const string RecipientsSignature =
        "0b879075ff6a71840aef5f88a237312387f05f0ed556eb88526f8f57a8480792";

    [Fact]
    public void whenMessageSigned_Compute_ShouldMatchPinnedVector() =>
        InboundMailSignature
            .Compute(Secret, InboundMailSignature.MessagePurpose, Timestamp, Recipient, Body)
            .ShouldBe(MessageSignature);

    [Fact]
    public void whenRecipientListSigned_Compute_ShouldMatchPinnedVector() =>
        InboundMailSignature
            .Compute(
                Secret,
                InboundMailSignature.RecipientsPurpose,
                Timestamp,
                InboundMailSignature.RecipientsPath,
                []
            )
            .ShouldBe(RecipientsSignature);

    [Fact]
    public void whenAnyPartChanges_Verify_ShouldRefuse()
    {
        InboundMailSignature
            .Verify(Secret, "message", Timestamp, Recipient, Body, MessageSignature)
            .ShouldBeTrue();
        InboundMailSignature
            .Verify(Secret, "recipients", Timestamp, Recipient, Body, MessageSignature)
            .ShouldBeFalse();
        InboundMailSignature
            .Verify(Secret, "message", "1763300001", Recipient, Body, MessageSignature)
            .ShouldBeFalse();
        InboundMailSignature
            .Verify(Secret, "message", Timestamp, "r-bbcdefghijklmnopqrst", Body, MessageSignature)
            .ShouldBeFalse();
        InboundMailSignature
            .Verify(Secret, "message", Timestamp, Recipient, [.. Body, 0x20], MessageSignature)
            .ShouldBeFalse();
        InboundMailSignature
            .Verify(
                Secret,
                "message",
                Timestamp,
                Recipient,
                Body,
                MessageSignature.ToUpperInvariant()
            )
            .ShouldBeFalse();
        InboundMailSignature
            .Verify(Secret, "message", Timestamp, Recipient, Body, null)
            .ShouldBeFalse();
        InboundMailSignature
            .Verify([], "message", Timestamp, Recipient, Body, MessageSignature)
            .ShouldBeFalse();
    }

    [Theory]
    [InlineData("1763300000", true)]
    [InlineData("1763299700", true)]
    [InlineData("1763300300", true)]
    [InlineData("1763299699", false)]
    [InlineData("1763300301", false)]
    [InlineData("", false)]
    [InlineData("-1763300000", false)]
    [InlineData("+1763300000", false)]
    [InlineData("1763300000.5", false)]
    [InlineData("１７６３３００００００", false)]
    [InlineData("9999999999999", false)]
    public void whenTimestampChecked_IsFresh_ShouldAllowFiveMinutesEitherSide(
        string timestamp,
        bool fresh
    ) =>
        InboundMailSignature
            .IsFresh(timestamp, DateTimeOffset.FromUnixTimeSeconds(1763300000))
            .ShouldBe(fresh);
}
