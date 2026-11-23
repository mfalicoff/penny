namespace Penny.Backend.Application.Mail;

// Sends a batch of messages over one connection and returns one outcome per message, in
// order. Implementations never throw for a failed message; a failure to reach the
// server makes every message `Retry`.
public interface IMailTransport
{
    Task<IReadOnlyList<MailOutcome>> SendAsync(
        IReadOnlyList<OutgoingMail> messages,
        CancellationToken cancellationToken
    );
}
