namespace Penny.Backend.Application.Abstractions.InboundMail;

// Parses, sanitizes and renders one raw message (MAZ-184). Throws
// MailRendererUnavailableException when the renderer cannot be reached, so the message
// is retried; every other problem is a rejection with a reason code.
public interface IInboundMailConverter
{
    Task<MailConversion> ConvertAsync(
        byte[] raw,
        IReadOnlyCollection<string> allowedSenders,
        CancellationToken cancellationToken
    );
}
