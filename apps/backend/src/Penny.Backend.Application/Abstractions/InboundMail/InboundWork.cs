namespace Penny.Backend.Application.Abstractions.InboundMail;

// A claimed inbound message (MAZ-184). `Attempts` already counts this one.
public sealed record InboundWork(
    string Id,
    string UserId,
    string AddressId,
    DateTimeOffset ReceivedAt,
    DateTimeOffset DueAt,
    int Attempts
);
