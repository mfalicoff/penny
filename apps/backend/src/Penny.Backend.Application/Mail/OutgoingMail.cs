namespace Penny.Backend.Application.Mail;

// One plain-text email ready to send. It carries a code, so it is never logged.
public sealed record OutgoingMail(string Id, string To, string Subject, string Text)
{
    public override string ToString() => "Outgoing mail (recipient and content redacted)";
}
