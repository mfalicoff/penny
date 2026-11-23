namespace Penny.Backend.Application.Mail;

public enum MailOutcomeKind
{
    // The server accepted the message.
    Sent,

    // A temporary failure (connection, timeout, 4xx): try again later.
    Retry,

    // The server refused the message for good (5xx): stop.
    Permanent,

    // Nothing to send any more (the invite was revoked, the account is gone).
    Dropped,
}
