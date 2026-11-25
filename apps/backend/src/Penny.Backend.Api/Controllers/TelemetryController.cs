using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Penny.Backend.Api.Authentication;
using Penny.Backend.Api.ClientTelemetry;
using Penny.Backend.Api.Configuration;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Application.Diagnostics;
using Penny.Backend.Domain.Errors;

namespace Penny.Backend.Api.Controllers;

// MAZ-129: opt-in client telemetry. The web app (Grafana Faro) and the iOS app (OTLP/HTTP
// JSON) post here with the person's session; the API checks the shape, scrubs URLs and
// messages again, re-masks Session Replay, drops repeats by Idempotency-Key and forwards to
// the collector on a private network (ClientTelemetryForwarder). Nothing reaches the
// collector from outside the API. Off (404) unless the operator configured it
// (ClientTelemetryOptions); session-protected by the fallback policy and rate limited per
// session. See docs/self-hosting/observability.md#client-telemetry.
[ApiController]
[Route("api/telemetry")]
[EnableRateLimiting(ClientTelemetryRateLimit.Policy)]
[ProducesResponseType<OkResponse>(202)]
[ProducesResponseType<ApiError>(400)]
[ProducesResponseType<ApiError>(401)]
[ProducesResponseType<ApiError>(403)]
[ProducesResponseType<ApiError>(404)]
[ProducesResponseType<ApiError>(413)]
[ProducesResponseType<ApiError>(415)]
[ProducesResponseType<ApiError>(429)]
public sealed class TelemetryController(
    ClientTelemetryOptions options,
    ClientTelemetryForwarder forwarder,
    IdempotencyKeys idempotency
) : ControllerBase
{
    public const string OffMessage = "Client telemetry is off on this server.";
    public const string InvalidMessage = "The telemetry report is not valid.";
    public const string TooLargeMessage = "The telemetry report is too large.";
    public const string MediaTypeMessage = "Send telemetry as uncompressed application/json.";
    public const string OtlpService = "penny-ios";

    private static readonly JsonDocumentOptions Parsing = new() { MaxDepth = 64 };

    [HttpPost("faro", Name = "postApiTelemetryFaro")]
    public async Task<IActionResult> Faro(CancellationToken cancellationToken)
    {
        if (options.FaroUrl is null)
            return StatusCode(404, new ApiError(OffMessage, ErrorCodes.TelemetryOff));
        return await AcceptAsync(
            "faro",
            options.FaroUrl,
            otlp: false,
            body => FaroPayload.Check(body, options.SessionReplay),
            cancellationToken
        );
    }

    [HttpPost("otlp/v1/traces", Name = "postApiTelemetryOtlpTraces")]
    public Task<IActionResult> Traces(CancellationToken cancellationToken) =>
        Otlp("traces", cancellationToken);

    [HttpPost("otlp/v1/logs", Name = "postApiTelemetryOtlpLogs")]
    public Task<IActionResult> Logs(CancellationToken cancellationToken) =>
        Otlp("logs", cancellationToken);

    private async Task<IActionResult> Otlp(string signal, CancellationToken cancellationToken)
    {
        if (options.OtlpEndpoint is null)
            return StatusCode(404, new ApiError(OffMessage, ErrorCodes.TelemetryOff));
        var target = new Uri(options.OtlpEndpoint.AbsoluteUri.TrimEnd('/') + "/v1/" + signal);
        return await AcceptAsync(
            signal,
            target,
            otlp: true,
            body =>
                body is JsonObject root && OtlpScrubber.Check(root, signal, OtlpService)
                    ? root
                    : null,
            cancellationToken
        );
    }

    private async Task<IActionResult> AcceptAsync(
        string kind,
        Uri target,
        bool otlp,
        Func<JsonNode?, JsonObject?> check,
        CancellationToken cancellationToken
    )
    {
        if (
            Request.ContentType is not { } contentType
            || !contentType.StartsWith("application/json", StringComparison.OrdinalIgnoreCase)
            || Request.Headers.ContentEncoding.Count > 0
        )
            return Refuse(kind, 415, ErrorCodes.TelemetryMediaType, MediaTypeMessage);
        if (Request.ContentLength > options.MaxPayloadBytes)
            return Refuse(kind, 413, ErrorCodes.TelemetryTooLarge, TooLargeMessage);
        var bytes = await ReadAsync(Request.Body, options.MaxPayloadBytes, cancellationToken);
        if (bytes is null)
            return Refuse(kind, 413, ErrorCodes.TelemetryTooLarge, TooLargeMessage);

        JsonObject? payload;
        try
        {
            payload = check(JsonNode.Parse(bytes, documentOptions: Parsing));
        }
        catch (JsonException)
        {
            payload = null;
        }
        if (payload is null)
            return Refuse(kind, 400, ErrorCodes.TelemetryInvalid, InvalidMessage);

        var key = Request.Headers[IdempotencyKeys.Header].ToString();
        if (
            key.Length > 0
            && IdempotencyKeys.IsValid(key)
            && !idempotency.TryClaim(User.Session().UserId, key)
        )
        {
            BackendTelemetry.ClientTelemetry(kind, "duplicate");
            return StatusCode(202, new OkResponse(true));
        }
        forwarder.Enqueue(
            new ClientTelemetryForwarder.Report(
                kind,
                target,
                Encoding.UTF8.GetBytes(payload.ToJsonString()),
                otlp
            )
        );
        return StatusCode(202, new OkResponse(true));
    }

    private ObjectResult Refuse(string kind, int status, string code, string message)
    {
        BackendTelemetry.ClientTelemetry(kind, "invalid");
        return StatusCode(status, new ApiError(message, code));
    }

    // The body, or null when it is longer than `limit` bytes.
    private static async Task<byte[]?> ReadAsync(
        Stream body,
        int limit,
        CancellationToken cancellationToken
    )
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[16 * 1024];
        int read;
        while ((read = await body.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (buffer.Length + read > limit)
                return null;
            buffer.Write(chunk, 0, read);
        }
        return buffer.ToArray();
    }
}
