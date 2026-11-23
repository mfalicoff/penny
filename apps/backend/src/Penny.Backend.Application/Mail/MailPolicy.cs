namespace Penny.Backend.Application.Mail;

// Email delivery settings the application needs (MAZ-124). `Enabled` is false when the
// operator configured no mail server: every email flow then answers 404 and clients
// fall back to codes. `AppUrl` is the web app origin links point to (one of the
// allowed origins). Limits count messages created in the last 24 hours.
public sealed record MailPolicy(
    bool Enabled,
    string AppUrl,
    TimeSpan InviteLifetime,
    int RecipientMessagesPerDay,
    int AccountMessagesPerDay
)
{
    public const string Disabled = "This server doesn't send email.";
    public static readonly TimeSpan LimitWindow = TimeSpan.FromHours(24);

    public static MailPolicy Off { get; } = new(false, "", TimeSpan.FromHours(72), 5, 20);
}
