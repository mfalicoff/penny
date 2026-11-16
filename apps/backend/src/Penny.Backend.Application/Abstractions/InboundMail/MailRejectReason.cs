namespace Penny.Backend.Application.Abstractions.InboundMail;

// Reason codes recorded on rejected or failed inbound messages (MAZ-184). They are a
// fixed vocabulary, safe for logs and metrics; never message content.
public static class MailRejectReason
{
    public const string Unparseable = "unparseable";
    public const string HeadersTooLarge = "headers_too_large";
    public const string TooDeep = "too_deep";
    public const string TooManyParts = "too_many_parts";
    public const string TooLarge = "decoded_too_large";
    public const string HtmlTooLarge = "html_too_large";
    public const string Timeout = "timeout";
    public const string SenderNotAllowed = "sender_not_allowed";
    public const string RenderTooLarge = "render_too_large";
    public const string RenderTooManyPages = "render_too_many_pages";
    public const string RenderInvalid = "render_invalid";
    public const string RenderUnavailable = "render_unavailable";
    public const string LeaseExpired = "lease_expired";
    public const string Unreadable = "unreadable";
}
