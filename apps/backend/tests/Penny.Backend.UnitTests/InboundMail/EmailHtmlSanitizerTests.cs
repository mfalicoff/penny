using Penny.Backend.Persistence.InboundMail;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.InboundMail;

// The malicious-mail corpus for the HTML sanitizer (MAZ-184, doc task 5): nothing that
// runs code, loads a URL or submits data survives; text content does.
public sealed class EmailHtmlSanitizerTests
{
    private static readonly Dictionary<string, string> Inline = new()
    {
        ["logo@shop"] = "data:image/png;base64,iVBORw0KGgo=",
    };

    private static string Clean(string html) => EmailHtmlSanitizer.Sanitize(html, Inline);

    [Theory]
    [InlineData("<script>alert(1)</script><p>Total</p>")]
    [InlineData("<p onclick=\"alert(1)\" onmouseover=alert(1)>Total</p>")]
    [InlineData("<img src=x onerror=alert(1)><p>Total</p>")]
    [InlineData("<iframe src=\"https://evil.example\"></iframe><p>Total</p>")]
    [InlineData("<object data=\"x.swf\"></object><embed src=\"x.swf\"><p>Total</p>")]
    [InlineData("<form action=\"https://evil.example\"><input name=card></form><p>Total</p>")]
    [InlineData("<svg><script>alert(1)</script></svg><math><mi>x</mi></math><p>Total</p>")]
    [InlineData(
        "<base href=\"https://evil.example/\"><link rel=stylesheet href=\"https://evil.example/a.css\"><p>Total</p>"
    )]
    [InlineData("<meta http-equiv=\"refresh\" content=\"0;url=https://evil.example\"><p>Total</p>")]
    [InlineData("<a href=\"javascript:alert(1)\">Total</a>")]
    [InlineData("<p style=\"background:url(javascript:alert(1))\">Total</p>")]
    public void whenActiveContentPresent_Sanitize_ShouldRemoveItAndKeepText(string html)
    {
        var clean = Clean(html).ToLowerInvariant();
        clean.ShouldContain("total");
        foreach (
            var forbidden in new[]
            {
                "<script",
                "onclick",
                "onerror",
                "onmouseover",
                "<iframe",
                "<object",
                "<embed",
                "<form",
                "<input",
                "<svg",
                "<math",
                "<base",
                "<link",
                "<meta",
                "javascript:",
                "evil.example",
                "alert",
            }
        )
            clean.ShouldNotContain(forbidden);
    }

    [Theory]
    [InlineData("<img src=\"http://169.254.169.254/latest/meta-data\">")]
    [InlineData("<img src=\"https://tracker.example/pixel.gif?u=1\" width=1 height=1>")]
    [InlineData("<img src=\"file:///etc/passwd\">")]
    [InlineData("<img src=\"data:image/svg+xml;base64,PHN2Zz4=\">")]
    [InlineData("<img src=\"cid:unknown@shop\">")]
    [InlineData("<img srcset=\"https://tracker.example/a.png 2x\">")]
    public void whenImageIsRemoteOrUnknown_Sanitize_ShouldReplaceItWithANote(string html)
    {
        var clean = Clean(html);
        clean.ShouldContain(EmailHtmlSanitizer.RemoteImageNote);
        clean.ShouldNotContain("169.254");
        clean.ShouldNotContain("tracker.example");
        clean.ShouldNotContain("file:");
        clean.ShouldNotContain("svg");
        clean.ShouldNotContain("<img");
    }

    [Fact]
    public void whenInlineImageReferenced_Sanitize_ShouldEmbedItsReencodedDataUrl()
    {
        var clean = Clean(
            "<img src=\"cid:logo@shop\" alt=\"Shop\"><img src=\"CID:%3Clogo@shop%3E\">"
        );
        clean.ShouldContain("src=\"data:image/png;base64,iVBORw0KGgo=\"");
        clean.ShouldNotContain("cid:");
    }

    [Theory]
    [InlineData("<style>@import url(https://evil.example/a.css); p{color:red}</style><p>Total</p>")]
    [InlineData(
        "<style>@font-face{font-family:x;src:url(https://evil.example/f.woff)}</style><p>Total</p>"
    )]
    [InlineData("<style>p{background-image:url(https://evil.example/p.png)}</style><p>Total</p>")]
    [InlineData("<p style=\"background-image:url('https://evil.example/p.png')\">Total</p>")]
    [InlineData("<p style=\"background:url(cid:logo@shop)\">Total</p>")]
    [InlineData(
        "<table background=\"https://evil.example/bg.png\"><tr><td>Total</td></tr></table>"
    )]
    public void whenCssLoadsUrls_Sanitize_ShouldDropThem(string html)
    {
        var clean = Clean(html);
        clean.ShouldContain("Total");
        clean.ShouldNotContain("evil.example");
        clean.ShouldNotContain("url(");
        clean.ShouldNotContain("@import");
        clean.ShouldNotContain("@font-face");
    }

    [Fact]
    public void whenLinkPresent_Sanitize_ShouldKeepItsTextWithoutTheTarget()
    {
        var clean = Clean(
            "<a href=\"https://track.example/c?id=1\" ping=\"https://track.example\">View order 1042</a>"
        );
        clean.ShouldContain("View order 1042");
        clean.ShouldNotContain("track.example");
        clean.ShouldNotContain("href");
    }

    [Fact]
    public void whenReceiptLayoutUsed_Sanitize_ShouldKeepTablesAndInlineStyles()
    {
        var clean = Clean(
            "<style>.total{font-weight:bold}</style><table width=\"600\" align=\"center\" bgcolor=\"#ffffff\"><tr><td class=\"total\" style=\"color:#333;padding:4px\">$12.50</td></tr></table>"
        );
        clean.ShouldContain("<table");
        clean.ShouldContain("$12.50");
        clean.ShouldContain("color: rgba(51, 51, 51, 1)");
        clean.ShouldContain("font-weight: bold");
    }
}
