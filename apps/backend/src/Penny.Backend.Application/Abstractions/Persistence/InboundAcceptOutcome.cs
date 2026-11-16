namespace Penny.Backend.Application.Abstractions.Persistence;

// What the ingress did with a verified message (MAZ-184). Only `Accepted` stores
// anything; `Duplicate` is answered like an accepted message.
public enum InboundAcceptOutcome
{
    Accepted,
    Duplicate,
    UnknownAddress,
    RateLimited,
}
