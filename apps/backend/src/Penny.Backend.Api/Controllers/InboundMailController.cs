using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http.Timeouts;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Api.InboundMail;
using Penny.Backend.Application.InboundMail;

namespace Penny.Backend.Api.Controllers;

// The Email Worker's endpoints (MAZ-184, docs/plans/email-receipts.md#signed-endpoint).
// No session: every request is authenticated by the HMAC signature instead. The public
// web proxy does not route /api/inbound-mail; the Worker reaches it through a
// Cloudflare Tunnel or behind Cloudflare Access. While the feature is off both routes
// answer 404. Responses never echo the address or the message.
[ApiController]
[AllowAnonymous]
[Route(InboundMailHeaders.Path)]
[DisableRequestTimeout]
public sealed class InboundMailController(InboundMailService ingress) : ControllerBase
{
    public const string BadSignature = "The request signature is missing or invalid.";
    public const string UnknownAddressMessage = "Unknown address.";
    public const string RateLimitedMessage = "Too many messages for this address. Try again later.";
    public const string TooLargeMessage = "The message is too large.";
    public const string InvalidMessage = "The message is empty.";
    public const string NotFoundMessage = "API route not found.";

    [HttpPost(Name = "postApiInboundMail")]
    [ProducesResponseType<OkResponse>(202)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(401)]
    [ProducesResponseType<ApiError>(404)]
    [ProducesResponseType<ApiError>(413)]
    [ProducesResponseType<ApiError>(429)]
    public async Task<IActionResult> Receive(CancellationToken cancellationToken)
    {
        if (!ingress.Enabled)
            return Error(404, NotFoundMessage);
        var recipient = Header(InboundMailHeaders.Recipient);
        var timestamp = Header(InboundMailHeaders.Timestamp);
        var signature = Header(InboundMailHeaders.Signature);
        // Unsigned or stale requests are refused before the body is read.
        if (!ingress.HasSignedHeaders(recipient, timestamp, signature))
            return Error(401, BadSignature);
        if (Request.ContentLength > ingress.MaxMessageBytes)
            return Error(413, TooLargeMessage);
        var raw = await ReadBodyAsync(ingress.MaxMessageBytes, cancellationToken);
        if (raw is null)
            return Error(413, TooLargeMessage);
        return await ingress.ReceiveAsync(
            recipient,
            timestamp,
            signature,
            raw,
            cancellationToken
        ) switch
        {
            InboundOutcome.Accepted or InboundOutcome.Duplicate => StatusCode(
                202,
                new OkResponse(true)
            ),
            InboundOutcome.UnknownAddress => Error(404, UnknownAddressMessage),
            InboundOutcome.RateLimited => Error(429, RateLimitedMessage),
            InboundOutcome.TooLarge => Error(413, TooLargeMessage),
            InboundOutcome.Invalid => Error(400, InvalidMessage),
            _ => Error(401, BadSignature),
        };
    }

    [HttpGet("recipients", Name = "getApiInboundMailRecipients")]
    [EnableRateLimiting(InboundMailRateLimit.Policy)]
    [ProducesResponseType<InboundRecipientsResponse>(200)]
    [ProducesResponseType(304)]
    [ProducesResponseType<ApiError>(401)]
    [ProducesResponseType<ApiError>(404)]
    [ProducesResponseType<ApiError>(429)]
    public async Task<IActionResult> Recipients(CancellationToken cancellationToken)
    {
        if (!ingress.Enabled)
            return Error(404, NotFoundMessage);
        var list = await ingress.RecipientsAsync(
            Header(InboundMailHeaders.Timestamp),
            Header(InboundMailHeaders.Signature),
            cancellationToken
        );
        if (list is null)
            return Error(401, BadSignature);
        var etag = $"\"{list.Version}\"";
        Response.Headers.ETag = etag;
        if (Request.Headers.IfNoneMatch.Any(value => value == etag || value == list.Version))
            return StatusCode(304);
        return Ok(
            new InboundRecipientsResponse(
                list.Version,
                list.GeneratedAt.ToUnixTimeMilliseconds(),
                list.Hashes
            )
        );
    }

    private string? Header(string name) =>
        Request.Headers.TryGetValue(name, out var values) && values.Count == 1 ? values[0] : null;

    // The whole body, or null when it is longer than `limit`.
    private async Task<byte[]?> ReadBodyAsync(long limit, CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await Request.Body.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (buffer.Length + read > limit)
                return null;
            buffer.Write(chunk, 0, read);
        }
        return buffer.ToArray();
    }

    private ObjectResult Error(int status, string message) =>
        StatusCode(status, new ApiError(message));
}
