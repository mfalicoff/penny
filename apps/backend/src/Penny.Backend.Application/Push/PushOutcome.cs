namespace Penny.Backend.Application.Push;

// A transport's answer for one message. `Reason` is a redacted diagnostic code such
// as `apns:410:Unregistered` or `expo:http-503`: never a token, payload or response
// body. `RetryAfter` is the provider's requested delay, if any.
public sealed record PushOutcome(
    PushOutcomeKind Kind,
    string? Reason = null,
    string? TicketId = null,
    TimeSpan? RetryAfter = null
)
{
    public static PushOutcome Accepted(string? ticketId) =>
        new(PushOutcomeKind.Accepted, null, ticketId);

    public static PushOutcome Retry(string reason, TimeSpan? retryAfter = null) =>
        new(PushOutcomeKind.Retry, reason, null, retryAfter);

    public static PushOutcome Permanent(string reason) => new(PushOutcomeKind.Permanent, reason);

    public static PushOutcome InvalidToken(string reason) =>
        new(PushOutcomeKind.InvalidToken, reason);
}
