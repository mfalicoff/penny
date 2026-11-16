namespace Penny.Backend.Application.Abstractions.Persistence;

// A verified ingress request: the recipient's local part hash and the raw MIME. MAZ-184.
public sealed record InboundDelivery(string LocalPartHash, byte[] Raw, DateTimeOffset ReceivedAt);
