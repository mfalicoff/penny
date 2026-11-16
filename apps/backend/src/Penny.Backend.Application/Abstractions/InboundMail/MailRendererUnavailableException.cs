namespace Penny.Backend.Application.Abstractions.InboundMail;

// The renderer did not answer (down, restarting, timed out at the connection level).
// The message is retried later. MAZ-184.
public sealed class MailRendererUnavailableException(Exception? inner = null)
    : Exception("The email renderer is unavailable.", inner);
