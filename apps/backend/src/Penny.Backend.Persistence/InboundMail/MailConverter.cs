using System.Text;
using System.Text.RegularExpressions;
using MimeKit;
using Penny.Backend.Application.Abstractions.InboundMail;
using Penny.Backend.Application.InboundMail;
using Penny.Backend.Application.Receipts;

namespace Penny.Backend.Persistence.InboundMail;

// Turns one raw message into receipts (MAZ-184, docs/plans/email-receipts.md#2-parsing-inbound-mail-worker):
// 1. Parse with MimeKit within the limits (header block, depth, parts, decoded sizes).
// 2. Apply the sender policy: with an allowlist, only DMARC-verified senders on it.
// 3. Keep attachments whose declared type is a receipt type and whose bytes match it;
//    list the rest as not imported. Re-encode referenced inline images to PNG.
// 4. Sanitize the HTML body (or escape the text body) under a fixed cover header.
// 5. Render in penny-render and check the PDF's signature, size and page count.
// Nothing here logs or returns message content except the conversion itself.
public sealed partial class MailConverter(
    IEmailRenderer renderer,
    MailImageTools images,
    MailLimits limits,
    string authServId
) : IInboundMailConverter
{
    public async Task<MailConversion> ConvertAsync(
        byte[] raw,
        IReadOnlyCollection<string> allowedSenders,
        CancellationToken cancellationToken
    )
    {
        if (!HeaderBlockWithin(raw, limits.MaxHeaderBytes))
            return MailConversion.Reject(
                MailRejectReason.HeadersTooLarge,
                MailAuthentication.Missing
            );
        MimeMessage message;
        try
        {
            using var stream = new MemoryStream(raw, writable: false);
            message = await MimeMessage.LoadAsync(
                new ParserOptions { MaxMimeDepth = limits.MaxDepth + 1 },
                stream,
                cancellationToken
            );
        }
        catch (FormatException)
        {
            return MailConversion.Reject(MailRejectReason.Unparseable, MailAuthentication.Missing);
        }
        using (message)
            return await ConvertAsync(message, allowedSenders, cancellationToken);
    }

    private async Task<MailConversion> ConvertAsync(
        MimeMessage message,
        IReadOnlyCollection<string> allowedSenders,
        CancellationToken cancellationToken
    )
    {
        var authentication = MailAuthenticationReader.Read(message.Headers, authServId);
        var (depth, parts) = Measure(message.Body, 1);
        if (depth > limits.MaxDepth)
            return MailConversion.Reject(MailRejectReason.TooDeep, authentication);
        if (parts > limits.MaxParts)
            return MailConversion.Reject(MailRejectReason.TooManyParts, authentication);

        var from = message.From.Mailboxes.FirstOrDefault();
        if (
            allowedSenders.Count > 0
            && (
                !authentication.Verified
                || from is null
                || !AllowedSenders.Allows(allowedSenders, from.Address)
            )
        )
            return MailConversion.Reject(MailRejectReason.SenderNotAllowed, authentication);

        long decoded = 0;
        var html = message.HtmlBody;
        var text = html is null ? message.TextBody : null;
        var bodyBytes = Encoding.UTF8.GetByteCount(html ?? text ?? "");
        if (bodyBytes > limits.MaxHtmlBytes)
            return MailConversion.Reject(MailRejectReason.HtmlTooLarge, authentication);
        decoded += bodyBytes;

        var referenced = html is null
            ? new HashSet<string>(StringComparer.Ordinal)
            : ContentIds()
                .Matches(html)
                .Select(match => CleanContentId(match.Groups[1].Value))
                .ToHashSet(StringComparer.Ordinal);
        var inline = new Dictionary<string, string>(StringComparer.Ordinal);
        var receipts = new List<ConvertedReceipt>();
        var imported = new List<string>();
        var skipped = new List<string>();
        foreach (var entity in message.BodyParts)
        {
            if (entity is MessagePart forwarded)
            {
                skipped.Add(
                    MailText.FileName(forwarded.ContentDisposition?.FileName, ".eml")
                        + " (attached email)"
                );
                continue;
            }
            if (entity is not MimePart part || (part is TextPart && !part.IsAttachment))
                continue;
            var contentId = part.ContentId is null ? null : CleanContentId(part.ContentId);
            var isInline =
                !part.IsAttachment
                && contentId is not null
                && part.ContentType.MediaType.Equals("image", StringComparison.OrdinalIgnoreCase);
            if (isInline && !referenced.Contains(contentId!))
                continue; // An unreferenced inline image (a signature logo): neither shown nor imported.
            var mime = Mime(part);
            var name = MailText.FileName(part.FileName, MailText.Extension(mime));
            if (!ReceiptFormat.Mimes.Contains(mime, StringComparer.Ordinal))
            {
                if (!isInline)
                    skipped.Add(name);
                continue;
            }
            var content = Decode(part, limits.MaxAttachmentBytes);
            if (content is null)
            {
                if (!isInline)
                    skipped.Add(name + " (larger than 10 MB)");
                continue;
            }
            decoded += content.Length;
            if (decoded > limits.MaxTotalDecodedBytes)
                return MailConversion.Reject(MailRejectReason.TooLarge, authentication);
            if (!ReceiptFormat.IsAcceptable(mime, content))
            {
                if (!isInline)
                    skipped.Add(name);
                continue;
            }
            if (isInline)
            {
                if (inline.Count < limits.MaxInlineImages && !inline.ContainsKey(contentId!))
                {
                    var png = await images.ReencodePngAsync(
                        content,
                        limits.MaxImageDimension,
                        cancellationToken
                    );
                    if (png is not null)
                        inline[contentId!] = "data:image/png;base64," + Convert.ToBase64String(png);
                }
                continue;
            }
            receipts.Add(new(ConvertedReceipt.Attachment, name, mime, content));
            imported.Add(name);
        }

        var subject = MailText.Clean(message.Subject);
        var cover = new EmailDocument.Cover(
            from is null ? "" : MailText.Clean(from.ToString()),
            MailText.Clean(message.To.ToString(), 500),
            message.Headers.Contains(HeaderId.Date) ? message.Date : null,
            subject,
            authentication.Verified
                ? "Verified (the sender's domain passed DMARC)"
                : "Not verified. Penny couldn't confirm who sent this email.",
            imported,
            skipped
        );
        var document = EmailDocument.Build(
            cover,
            html is null ? null : EmailHtmlSanitizer.Sanitize(html, inline),
            text
        );
        var pdf = await renderer.RenderAsync(document, limits.MaxPdfBytes, cancellationToken);
        if (pdf is null)
            return MailConversion.Reject(MailRejectReason.RenderTooLarge, authentication);
        if (!ReceiptFormat.IsAcceptable("application/pdf", pdf))
            return MailConversion.Reject(MailRejectReason.RenderInvalid, authentication);
        var pages = await images.PageCountAsync(pdf, cancellationToken);
        if (pages is null)
            return MailConversion.Reject(MailRejectReason.RenderInvalid, authentication);
        if (pages > limits.MaxPages)
            return MailConversion.Reject(MailRejectReason.RenderTooManyPages, authentication);

        var title = subject.Length == 0 ? "Email" : subject;
        var emailName = MailText.FileName(title.Length > 200 ? title[..200] : title, "") + ".pdf";
        receipts.Insert(0, new(ConvertedReceipt.Email, emailName, "application/pdf", pdf));
        var sender = from is null
            ? ""
            : MailText.Clean(string.IsNullOrWhiteSpace(from.Name) ? from.Address : from.Name, 200);
        return new MailConversion(null, authentication, subject, sender, receipts);
    }

    // The declared type, normalized; `application/octet-stream` takes the type its
    // file extension names (the bytes must still match it).
    private static string Mime(MimePart part)
    {
        var mime = part.ContentType.MimeType.ToLowerInvariant();
        mime = mime switch
        {
            "image/jpg" or "image/pjpeg" => "image/jpeg",
            "application/x-pdf" or "application/acrobat" => "application/pdf",
            _ => mime,
        };
        if (mime != "application/octet-stream")
            return mime;
        return Path.GetExtension(part.FileName ?? "").ToLowerInvariant() switch
        {
            ".pdf" => "application/pdf",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png" => "image/png",
            ".webp" => "image/webp",
            ".gif" => "image/gif",
            ".heic" => "image/heic",
            ".heif" => "image/heif",
            _ => mime,
        };
    }

    private static byte[]? Decode(MimePart part, long limit)
    {
        if (part.Content is null)
            return [];
        using var buffer = new BoundedStream(limit);
        try
        {
            part.Content.DecodeTo(buffer);
        }
        catch (BoundedStream.LimitExceededException)
        {
            return null;
        }
        return buffer.ToArray();
    }

    private static (int Depth, int Parts) Measure(MimeEntity? entity, int depth)
    {
        switch (entity)
        {
            case Multipart multipart:
            {
                var (deepest, parts) = (depth, 1);
                foreach (var child in multipart)
                {
                    var (childDepth, childParts) = Measure(child, depth + 1);
                    deepest = Math.Max(deepest, childDepth);
                    parts += childParts;
                }
                return (deepest, parts);
            }
            case MessagePart { Message: { } inner }:
            {
                var (childDepth, childParts) = Measure(inner.Body, depth + 1);
                return (childDepth, childParts + 1);
            }
            default:
                return (depth, entity is null ? 0 : 1);
        }
    }

    // The header block ends at the first empty line, within `limit` bytes.
    private static bool HeaderBlockWithin(byte[] raw, int limit)
    {
        var window = raw.AsSpan(0, Math.Min(raw.Length, limit + 4));
        return window.IndexOf("\r\n\r\n"u8) >= 0
            || window.IndexOf("\n\n"u8) >= 0
            || raw.Length <= limit;
    }

    private static string CleanContentId(string value) =>
        Uri.UnescapeDataString(value).Trim().Trim('<', '>');

    [GeneratedRegex(
        @"cid:([^""'\s)>]{1,200})",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant
    )]
    private static partial Regex ContentIds();
}
