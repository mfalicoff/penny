namespace Penny.Backend.Application.Mail;

// A redacted reason code (`smtp:451`, `smtp:connect`), never server text, which may
// echo the address.
public sealed record MailOutcome(MailOutcomeKind Kind, string? Reason)
{
    public static MailOutcome Sent { get; } = new(MailOutcomeKind.Sent, null);

    public static MailOutcome Retry(string reason) => new(MailOutcomeKind.Retry, reason);

    public static MailOutcome Permanent(string reason) => new(MailOutcomeKind.Permanent, reason);

    public static MailOutcome Dropped(string reason) => new(MailOutcomeKind.Dropped, reason);
}
