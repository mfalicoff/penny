namespace Penny.Backend.Persistence.InboundMail;

// Parser and renderer limits (MAZ-184, docs/plans/email-receipts.md#2-parsing-inbound-mail-worker).
// Exceeding a message-wide limit rejects the message; an attachment over the receipt
// limit is skipped and listed on the cover page.
public sealed record MailLimits(
    int MaxDepth = 8,
    int MaxParts = 50,
    int MaxHeaderBytes = 64 * 1024,
    int MaxAttachmentBytes = 10 * 1024 * 1024,
    long MaxTotalDecodedBytes = 40L * 1024 * 1024,
    int MaxHtmlBytes = 2 * 1024 * 1024,
    int MaxInlineImages = 30,
    int MaxImageDimension = 2000,
    int MaxPages = 50,
    long MaxPdfBytes = 10 * 1024 * 1024
)
{
    public static MailLimits Default { get; } = new();
}
