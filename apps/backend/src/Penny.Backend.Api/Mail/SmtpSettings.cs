namespace Penny.Backend.Api.Mail;

// The outgoing mail server. The password comes from the secret manager and is never
// logged; ToString leaves it out.
public sealed record SmtpSettings(
    string Host,
    int Port,
    SmtpSecurity Security,
    string? Username,
    string? Password,
    string From,
    string FromName,
    TimeSpan Timeout
)
{
    public override string ToString() => $"SMTP {Host}:{Port} ({Security})";
}
