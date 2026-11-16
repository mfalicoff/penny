namespace Penny.Backend.Application.Abstractions.InboundMail;

// The result of turning one raw message into receipts (MAZ-184). Either `Rejected` (a
// reason code, nothing is stored) or the inbox item's text fields and its receipts,
// rendered email first. Subject and sender are cleaned display text.
public sealed record MailConversion(
    string? RejectReason,
    MailAuthentication Authentication,
    string Subject,
    string From,
    IReadOnlyList<ConvertedReceipt> Receipts
)
{
    public bool Rejected => RejectReason is not null;

    public static MailConversion Reject(string reason, MailAuthentication authentication) =>
        new(reason, authentication, "", "", []);
}
