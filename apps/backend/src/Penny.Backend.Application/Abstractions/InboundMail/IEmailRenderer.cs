namespace Penny.Backend.Application.Abstractions.InboundMail;

// Renders one self-contained, sanitized HTML document to PDF in the isolated
// `penny-render` container (MAZ-184). Returns null when the output exceeds `maxBytes`.
public interface IEmailRenderer
{
    Task<byte[]?> RenderAsync(string html, long maxBytes, CancellationToken cancellationToken);
}
