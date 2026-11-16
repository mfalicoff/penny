namespace Penny.Backend.Application.InboundMail;

// The ingress answer (MAZ-184): 202 for Accepted and Duplicate, 404 UnknownAddress,
// 429 RateLimited, 413 TooLarge, 400 Invalid, 401 Unauthorized.
public enum InboundOutcome
{
    Accepted,
    Duplicate,
    UnknownAddress,
    RateLimited,
    TooLarge,
    Invalid,
    Unauthorized,
}
