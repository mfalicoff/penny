using System.Text;
using MimeKit;
using Penny.Backend.Application.Abstractions.InboundMail;
using Penny.Backend.Persistence.InboundMail;
using Penny.Backend.Persistence.Receipts;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.InboundMail;

// The mail converter (MAZ-184, doc task 5) with the real libvips and pdfinfo (installed
// for OCR, docs/development/testing.md) and a renderer that records the document it
// was given. Every message is synthetic.
public sealed class MailConverterTests
{
    private const string Ingress = "mx.cloudflare.net";
    private const string VerifiedSet =
        "i=1; mx.cloudflare.net; dkim=pass header.d=shop.example; dmarc=pass header.from=shop.example; spf=pass";

    // A 1x1 PNG.
    private static readonly byte[] Png = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    );

    private sealed class RecordingRenderer(byte[]? output = null) : IEmailRenderer
    {
        public string Html { get; private set; } = "";

        public Task<byte[]?> RenderAsync(
            string html,
            long maxBytes,
            CancellationToken cancellationToken
        )
        {
            Html = html;
            var pdf = output ?? TestPdf.Create();
            return Task.FromResult<byte[]?>(pdf.Length > maxBytes ? null : pdf);
        }
    }

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static MailConverter Converter(RecordingRenderer renderer, MailLimits? limits = null) =>
        new(
            renderer,
            new MailImageTools(new OcrEngineSettings("tesseract", null, ["eng"], null)),
            limits ?? MailLimits.Default,
            Ingress
        );

    private static byte[] Raw(MimeMessage message)
    {
        using var stream = new MemoryStream();
        message.WriteTo(stream);
        return stream.ToArray();
    }

    private static MimeMessage Message(
        BodyBuilder body,
        string subject = "Your order 1042",
        bool verified = false
    )
    {
        var message = new MimeMessage();
        message.From.Add(new MailboxAddress("Acme Store", "orders@shop.example"));
        message.To.Add(new MailboxAddress("", "r-abcdefghijklmnopqrst@receipts.example.test"));
        message.Subject = subject;
        message.Date = new DateTimeOffset(2026, 11, 16, 12, 0, 0, TimeSpan.Zero);
        message.Body = body.ToMessageBody();
        if (verified)
            message.Headers.Insert(0, new Header("ARC-Authentication-Results", VerifiedSet));
        return message;
    }

    [Fact]
    public async Task whenHtmlReceiptWithPdfAttachment_Convert_ShouldRenderSanitizedEmailAndImportThePdf()
    {
        var pdf = TestPdf.Create(2);
        var body = new BodyBuilder
        {
            HtmlBody =
                "<p>Total <b>$12.50</b></p><script>alert(1)</script><img src=\"https://tracker.example/p.gif\">",
        };
        body.Attachments.Add("invoice-0412.pdf", pdf, new ContentType("application", "pdf"));
        var renderer = new RecordingRenderer();

        var result = await Converter(renderer)
            .ConvertAsync(Raw(Message(body, verified: true)), [], Ct);

        result.Rejected.ShouldBeFalse();
        result.Subject.ShouldBe("Your order 1042");
        result.From.ShouldBe("Acme Store");
        result.Authentication.Verified.ShouldBeTrue();
        result
            .Receipts.Select(receipt => (receipt.Kind, receipt.Name, receipt.Mime))
            .ShouldBe([
                ("email", "Your order 1042.pdf", "application/pdf"),
                ("attachment", "invoice-0412.pdf", "application/pdf"),
            ]);
        result.Receipts[1].Content.ShouldBe(pdf);
        renderer.Html.ShouldContain("$12.50");
        renderer.Html.ShouldContain("Content-Security-Policy");
        renderer.Html.ShouldContain("invoice-0412.pdf");
        renderer.Html.ShouldContain("Verified");
        renderer.Html.ShouldNotContain("<script");
        renderer.Html.ShouldNotContain("tracker.example");
    }

    [Fact]
    public async Task whenPlainTextBody_Convert_ShouldEscapeItInsideAPre()
    {
        var renderer = new RecordingRenderer();
        var result = await Converter(renderer)
            .ConvertAsync(
                Raw(Message(new BodyBuilder { TextBody = "Total: <b>$4.50</b> & tip" })),
                [],
                Ct
            );
        result.Rejected.ShouldBeFalse();
        renderer.Html.ShouldContain(
            "<pre class=\"penny-text\">Total: &lt;b&gt;$4.50&lt;/b&gt; &amp; tip"
        );
        renderer.Html.ShouldContain("Not verified");
    }

    [Fact]
    public async Task whenAttachmentsAreNotReceipts_Convert_ShouldSkipAndListThem()
    {
        var body = new BodyBuilder { TextBody = "See attached." };
        body.Attachments.Add(
            "invoice.pdf",
            Encoding.ASCII.GetBytes("MZ\u0090 not a pdf"),
            new ContentType("application", "pdf")
        );
        body.Attachments.Add(
            "prices.zip",
            [0x50, 0x4B, 0x03, 0x04],
            new ContentType("application", "zip")
        );
        body.Attachments.Add(
            "statement.pdf",
            TestPdf.Create(),
            new ContentType("application", "octet-stream")
        );
        body.Attachments.Add("‮gpj.exe", Png, new ContentType("image", "png"));
        var renderer = new RecordingRenderer();

        var result = await Converter(renderer).ConvertAsync(Raw(Message(body)), [], Ct);

        result
            .Receipts.Select(receipt => receipt.Name)
            .ShouldBe(["Your order 1042.pdf", "statement.pdf", "gpj.exe"]);
        result.Receipts[2].Mime.ShouldBe("image/png");
        renderer.Html.ShouldContain("Not imported");
        renderer.Html.ShouldContain("invoice.pdf");
        renderer.Html.ShouldContain("prices.zip");
        renderer.Html.ShouldNotContain("‮");
    }

    [Fact]
    public async Task whenInlineImageReferenced_Convert_ShouldEmbedAReencodedPngAndNotImportIt()
    {
        var body = new BodyBuilder();
        var logo = body.LinkedResources.Add("logo.png", Png, new ContentType("image", "png"));
        logo.ContentId = "logo@shop.example";
        var unused = body.LinkedResources.Add("footer.png", Png, new ContentType("image", "png"));
        unused.ContentId = "footer@shop.example";
        body.HtmlBody = "<img src=\"cid:logo@shop.example\"><p>Thanks</p>";
        var renderer = new RecordingRenderer();

        var result = await Converter(renderer).ConvertAsync(Raw(Message(body)), [], Ct);

        result.Receipts.Count.ShouldBe(1);
        renderer.Html.ShouldContain("src=\"data:image/png;base64,iVBORw0KGgo");
        renderer.Html.ShouldNotContain("cid:");
    }

    [Fact]
    public async Task whenAttachmentOverTheReceiptLimit_Convert_ShouldSkipIt()
    {
        var body = new BodyBuilder { TextBody = "Big scan attached." };
        body.Attachments.Add("scan.pdf", TestPdf.Create(), new ContentType("application", "pdf"));
        var limits = MailLimits.Default with { MaxAttachmentBytes = 100 };
        var renderer = new RecordingRenderer();

        var result = await Converter(renderer, limits).ConvertAsync(Raw(Message(body)), [], Ct);

        result.Receipts.Count.ShouldBe(1);
        renderer.Html.ShouldContain("scan.pdf (larger than 10 MB)");
    }

    [Fact]
    public async Task whenDecodedTotalTooLarge_Convert_ShouldReject()
    {
        var body = new BodyBuilder { TextBody = "Two invoices." };
        body.Attachments.Add("a.pdf", TestPdf.Create(), new ContentType("application", "pdf"));
        body.Attachments.Add("b.pdf", TestPdf.Create(2), new ContentType("application", "pdf"));
        var limits = MailLimits.Default with { MaxTotalDecodedBytes = 500 };
        (
            await Converter(new RecordingRenderer(), limits)
                .ConvertAsync(Raw(Message(body)), [], Ct)
        ).RejectReason.ShouldBe(MailRejectReason.TooLarge);
    }

    [Fact]
    public async Task whenNestedTooDeep_Convert_ShouldReject()
    {
        MimeEntity entity = new TextPart("plain") { Text = "deep" };
        for (var level = 0; level < 12; level++)
            entity = new Multipart("mixed") { entity };
        var message = Message(new BodyBuilder { TextBody = "x" });
        message.Body = entity;
        (
            await Converter(new RecordingRenderer()).ConvertAsync(Raw(message), [], Ct)
        ).RejectReason.ShouldBe(MailRejectReason.TooDeep);
    }

    [Fact]
    public async Task whenTooManyParts_Convert_ShouldReject()
    {
        var multipart = new Multipart("mixed");
        for (var index = 0; index < 60; index++)
            multipart.Add(new TextPart("plain") { Text = $"part {index}" });
        var message = Message(new BodyBuilder { TextBody = "x" });
        message.Body = multipart;
        (
            await Converter(new RecordingRenderer()).ConvertAsync(Raw(message), [], Ct)
        ).RejectReason.ShouldBe(MailRejectReason.TooManyParts);
    }

    [Fact]
    public async Task whenHeaderBlockTooLarge_Convert_ShouldRejectBeforeParsing()
    {
        var raw = Encoding.ASCII.GetBytes(
            "From: a@shop.example\r\nX-Filler: " + new string('a', 70 * 1024) + "\r\n\r\nbody\r\n"
        );
        (await Converter(new RecordingRenderer()).ConvertAsync(raw, [], Ct)).RejectReason.ShouldBe(
            MailRejectReason.HeadersTooLarge
        );
    }

    [Fact]
    public async Task whenHtmlBodyTooLarge_Convert_ShouldReject()
    {
        var limits = MailLimits.Default with { MaxHtmlBytes = 1000 };
        var body = new BodyBuilder { HtmlBody = "<p>" + new string('x', 2000) + "</p>" };
        (
            await Converter(new RecordingRenderer(), limits)
                .ConvertAsync(Raw(Message(body)), [], Ct)
        ).RejectReason.ShouldBe(MailRejectReason.HtmlTooLarge);
    }

    [Fact]
    public async Task whenAllowlistSet_Convert_ShouldAcceptOnlyVerifiedListedSenders()
    {
        var body = new BodyBuilder { TextBody = "Receipt" };
        var converter = Converter(new RecordingRenderer());
        (
            await converter.ConvertAsync(Raw(Message(body, verified: true)), ["shop.example"], Ct)
        ).Rejected.ShouldBeFalse();
        (
            await converter.ConvertAsync(Raw(Message(body, verified: false)), ["shop.example"], Ct)
        ).RejectReason.ShouldBe(MailRejectReason.SenderNotAllowed);
        (
            await converter.ConvertAsync(Raw(Message(body, verified: true)), ["other.example"], Ct)
        ).RejectReason.ShouldBe(MailRejectReason.SenderNotAllowed);
    }

    [Fact]
    public async Task whenRendererOutputIsNotAPdf_Convert_ShouldReject() =>
        (
            await Converter(new RecordingRenderer(Encoding.ASCII.GetBytes("<html>")))
                .ConvertAsync(Raw(Message(new BodyBuilder { TextBody = "x" })), [], Ct)
        ).RejectReason.ShouldBe(MailRejectReason.RenderInvalid);

    [Fact]
    public async Task whenRenderedPdfHasTooManyPages_Convert_ShouldReject() =>
        (
            await Converter(
                    new RecordingRenderer(TestPdf.Create(3)),
                    MailLimits.Default with
                    {
                        MaxPages = 2,
                    }
                )
                .ConvertAsync(Raw(Message(new BodyBuilder { TextBody = "x" })), [], Ct)
        ).RejectReason.ShouldBe(MailRejectReason.RenderTooManyPages);

    [Fact]
    public async Task whenRenderedPdfTooLarge_Convert_ShouldReject() =>
        (
            await Converter(
                    new RecordingRenderer(TestPdf.Create(20)),
                    MailLimits.Default with
                    {
                        MaxPdfBytes = 500,
                    }
                )
                .ConvertAsync(Raw(Message(new BodyBuilder { TextBody = "x" })), [], Ct)
        ).RejectReason.ShouldBe(MailRejectReason.RenderTooLarge);

    [Fact]
    public async Task whenForwardedEmailAttached_Convert_ShouldListItAsNotImported()
    {
        var inner = Message(new BodyBuilder { TextBody = "inner" }, "Inner");
        var body = new BodyBuilder { TextBody = "Fwd" };
        body.Attachments.Add(new MessagePart { Message = inner });
        var renderer = new RecordingRenderer();
        var result = await Converter(renderer).ConvertAsync(Raw(Message(body)), [], Ct);
        result.Receipts.Count.ShouldBe(1);
        renderer.Html.ShouldContain("(attached email)");
    }

    [Fact]
    public async Task whenSubjectHasHtmlAndControls_Convert_ShouldEscapeAndCleanIt()
    {
        var renderer = new RecordingRenderer();
        var result = await Converter(renderer)
            .ConvertAsync(
                Raw(Message(new BodyBuilder { TextBody = "x" }, "<img src=x onerror=alert(1)>‮")),
                [],
                Ct
            );
        result.Subject.ShouldBe("<img src=x onerror=alert(1)>");
        renderer.Html.ShouldContain("&lt;img src=x onerror=alert(1)&gt;");
        renderer.Html.ShouldNotContain("<img src=x");
    }
}
