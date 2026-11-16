using System.Globalization;
using System.Net;
using System.Text;

namespace Penny.Backend.Persistence.InboundMail;

// The HTML document penny-render turns into the email PDF (MAZ-184): a fixed cover
// header built from parsed, escaped fields, then the sanitized body (or the plain-text
// body, escaped in a <pre>). The CSP allows only inline styles and `data:` images.
public static class EmailDocument
{
    public const string ContentSecurityPolicy =
        "default-src 'none'; img-src data:; style-src 'unsafe-inline'";

    public sealed record Cover(
        string From,
        string To,
        DateTimeOffset? Date,
        string Subject,
        string SenderCheck,
        IReadOnlyList<string> Imported,
        IReadOnlyList<string> Skipped
    );

    public static string Build(Cover cover, string? sanitizedHtml, string? plainText)
    {
        var html = new StringBuilder(4096 + (sanitizedHtml?.Length ?? plainText?.Length ?? 0));
        html.Append("<!doctype html><html><head><meta charset=\"utf-8\">");
        html.Append("<meta http-equiv=\"Content-Security-Policy\" content=\"")
            .Append(ContentSecurityPolicy)
            .Append("\">");
        html.Append(
            "<style>.penny-cover{font:12px/1.4 -apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#222;border:1px solid #ccc;border-radius:6px;padding:10px 12px;margin:0 0 16px}"
                + ".penny-cover th{text-align:left;vertical-align:top;padding:2px 12px 2px 0;color:#666;font-weight:600;white-space:nowrap}"
                + ".penny-cover td{padding:2px 0;word-break:break-word}.penny-text{white-space:pre-wrap;font:13px/1.45 ui-monospace,Menlo,Consolas,monospace}"
                + ".penny-remote-image{color:#888;font-style:italic}</style>"
        );
        html.Append("</head><body><table class=\"penny-cover\" role=\"presentation\">");
        Row(html, "From", cover.From);
        Row(html, "To", cover.To);
        Row(
            html,
            "Date",
            cover.Date?.ToString("ddd, d MMM yyyy HH:mm zzz", CultureInfo.InvariantCulture) ?? ""
        );
        Row(html, "Subject", cover.Subject);
        Row(html, "Sender", cover.SenderCheck);
        if (cover.Imported.Count > 0)
            Row(html, "Attachments", string.Join(", ", cover.Imported));
        if (cover.Skipped.Count > 0)
            Row(html, "Not imported", string.Join(", ", cover.Skipped));
        html.Append("</table>");
        if (sanitizedHtml is not null)
            html.Append("<div class=\"penny-body\">").Append(sanitizedHtml).Append("</div>");
        else
            html.Append("<pre class=\"penny-text\">")
                .Append(WebUtility.HtmlEncode(plainText ?? ""))
                .Append("</pre>");
        html.Append("</body></html>");
        return html.ToString();
    }

    private static void Row(StringBuilder html, string label, string value) =>
        html.Append("<tr><th>")
            .Append(label)
            .Append("</th><td>")
            .Append(WebUtility.HtmlEncode(value))
            .Append("</td></tr>");
}
