namespace Penny.Backend.Application.Push;

public enum PushOutcomeKind
{
    // The provider took the message (an APNs 200).
    Accepted,

    // Transient: network, timeout, rate limit, provider outage or provider
    // configuration; the delivery is retried with backoff until it expires.
    Retry,

    // The provider rejected this message for good; it is not retried.
    Permanent,

    // The provider says the token is not (or no longer) a valid device token.
    InvalidToken,
}
